export type LinkKind = 'usb' | 'ble'
export type PinMode = 'idle' | 'input' | 'output' | 'pwm' | 'adc' | 'timer'
export interface Pin {
  pin: number
  mode: PinMode
  pull: string
  level: number | null
}
export interface Pwm {
  pin: number
  frequency: number
  duty: number
  resolution: number
  breath_ms: number
}
export interface Timer {
  id: number
  pin: number
  kind: 'pulse' | 'blink'
  high_ms: number
  low_ms: number
  count: number
  elapsed_ms: number
}
export interface Sample {
  pin: number
  raw: number
  millivolts: number | null
  calibrated: boolean
  uptime_ms: number
}
export interface Snapshot {
  revision: number
  uptime_ms: number
  ble_connected: boolean
  usb_active: boolean
  pins: Pin[]
  pwm: Pwm[]
  timers: Timer[]
  streams: { pin: number; interval_ms: number }[]
}
export interface Hello {
  name: string
  board: string
  firmware: string
  device_id: string
  protocol: number
  state: Snapshot
  capabilities: {
    features: string[]
    max_pwm: number
    max_timers: number
    status_led: number
    demo_led: number
    adc_max_mv: number
    adc_calibrated: boolean
  }
}
export type Message = {
  v: number
  id?: number
  ok?: boolean
  result?: unknown
  error?: { code: string; message: string }
  event?: string
  data?: Sample
}
export const PIN_NUMBERS = [0, 1, 3, 4, 5, 6, 7, 10, 13, 20, 21]

export interface Transport {
  connect(onData: (text: string) => void, onClose: (reason?: string) => void): Promise<void>
  write(data: Uint8Array): Promise<void>
  disconnect(): Promise<void>
}

export class LineReader {
  private buffer = ''
  private dropping = false
  constructor(
    private readonly onLine: (line: string) => void,
    private readonly max = 8192,
  ) {}
  push(text: string) {
    for (const char of text) {
      if (char === '\n') {
        if (!this.dropping && this.buffer.trim()) this.onLine(this.buffer)
        this.buffer = ''
        this.dropping = false
      } else if (!this.dropping) {
        this.buffer += char
        if (this.buffer.length > this.max) {
          this.buffer = ''
          this.dropping = true
        }
      }
    }
  }
}

export interface DeviceOption {
  id: string
  name: string
}

export async function discoverDevices(kind: LinkKind): Promise<DeviceOption[]> {
  let response: Response
  try {
    response = await fetch(`/api/device/discover?kind=${kind}`)
  } catch {
    throw new Error('无法访问后端，请检查工作台服务是否正在运行。')
  }
  const result = await response.json()
  if (!response.ok) throw new Error(result.detail ?? '后端设备搜索失败，请稍后重试。')
  return result.devices as DeviceOption[]
}

export class BackendTransport implements Transport {
  private socket?: WebSocket
  private closing = false
  constructor(
    private readonly kind: LinkKind,
    private readonly target: string,
  ) {}
  async connect(onData: (text: string) => void, onClose: (reason?: string) => void) {
    const url = new URL('/api/device/connect', window.location.href)
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('kind', this.kind)
    url.searchParams.set('target', this.target)
    const socket = new WebSocket(url)
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      let connected = false
      let failure = ''
      const timer = setTimeout(() => {
        reject(new Error('后端连接超时，请检查设备供电和后端服务后重试。'))
        socket.close()
      }, 25000)
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'connected') {
          connected = true
          clearTimeout(timer)
          resolve()
        } else if (message.type === 'data') onData(message.data)
        else if (message.type === 'error') {
          failure = message.message
          if (!connected) {
            clearTimeout(timer)
            reject(new Error(failure))
          }
          socket.close()
        }
      }
      socket.onerror = () => {
        failure ||= '无法连接后端设备通道，请检查工作台服务后重试。'
      }
      socket.onclose = () => {
        clearTimeout(timer)
        if (!connected) reject(new Error(failure || '后端设备连接已关闭，请重新搜索并连接。'))
        else if (!this.closing) onClose(failure || undefined)
      }
    })
  }
  async write(data: Uint8Array) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('后端设备连接已关闭')
    this.socket.send(new TextDecoder().decode(data))
  }
  async disconnect() {
    this.closing = true
    this.socket?.close()
    this.socket = undefined
  }
}

const errors: Record<string, string> = {
  protected_pin: '该引脚由 USB、Flash 或开发板启动功能保留，不能操纵。',
  pin_busy: '引脚已被其他功能占用，请先释放引脚。',
  capacity: '设备的可用通道已用完，请先停止一个任务。',
  invalid_argument: '参数超出设备支持范围，请检查频率、时间与引脚。',
  invalid_request: '设备无法识别请求格式，请检查协议版本。',
  hardware_error: '硬件驱动未能完成操作，请刷新设备状态后重试。',
  unknown_operation: '当前固件不支持此操作。',
}
export function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class DeviceClient {
  private transport?: Transport
  private pending?: {
    id: number
    resolve: (result: unknown) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
  private sequence = 0
  private generation = 0
  private chain: Promise<unknown> = Promise.resolve()
  onEvent: (message: Message) => void = () => {}
  onLog: (direction: string, text: string) => void = () => {}
  onClose: (reason?: string) => void = () => {}
  setHandlers(handlers: {
    onLog?: (direction: string, text: string) => void
    onClose?: (reason?: string) => void
    onEvent?: (message: Message) => void
  }) {
    this.onLog = handlers.onLog ?? (() => {})
    this.onClose = handlers.onClose ?? (() => {})
    this.onEvent = handlers.onEvent ?? (() => {})
  }
  get busy() {
    return this.pending !== undefined
  }
  async connect(kind: LinkKind, target: string | Transport = ''): Promise<Hello> {
    if (this.transport) throw new Error('请先断开当前设备')
    const gen = ++this.generation
    this.transport = typeof target === 'string' ? new BackendTransport(kind, target) : target
    const parser = new LineReader((line) => {
      if (gen === this.generation) this.receive(line)
    })
    try {
      await this.transport.connect(
        (text) => parser.push(text),
        (reason) => {
          if (gen !== this.generation) return
          void this.disconnect()
          this.onClose(reason)
        },
      )
      const hello = await this.request<Hello>('hello')
      if (hello.protocol !== 1 || hello.board !== 'luatos-esp32c3-usb' || !hello.state?.pins) {
        throw new Error('设备固件或协议不兼容，请安装本工程的专用固件。')
      }
      return hello
    } catch (error) {
      await this.disconnect()
      throw error
    }
  }
  private receive(line: string) {
    let message: Message
    try {
      message = JSON.parse(line) as Message
    } catch {
      this.onLog('设备', line.slice(0, 240))
      return
    }
    if (!message || typeof message !== 'object' || message.v !== 1) return
    if (message.event) {
      this.onEvent(message)
      return
    }
    if (!this.pending || this.pending.id !== message.id) return
    clearTimeout(this.pending.timer)
    if (message.ok === true) this.pending.resolve(message.result)
    else
      this.pending.reject(
        new Error(errors[message.error?.code ?? ''] ?? message.error?.message ?? '设备拒绝操作'),
      )
    this.pending = undefined
  }
  request<T = Snapshot>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    const generation = this.generation
    const task = this.chain.then(async () => {
      if (!this.transport || generation !== this.generation)
        throw new Error('设备已断开，请重新连接')
      const id = ++this.sequence
      const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, id, op, params }) + '\n')
      if (bytes.length > 1025) throw new Error('命令长度超出固件限制')
      if (op !== 'state') this.onLog('发送', `${op} ${JSON.stringify(params)}`)
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pending?.id === id) this.pending = undefined
          reject(new Error('设备响应超时；操作可能已执行，请刷新状态，不要直接重复提交。'))
        }, 6000)
        this.pending = { id, resolve: (value) => resolve(value as T), reject, timer }
        this.transport!.write(bytes).catch((error) => {
          if (this.pending?.id !== id) return
          clearTimeout(timer)
          this.pending = undefined
          reject(error)
        })
      })
    })
    this.chain = task.catch(() => {})
    return task
  }
  async disconnect() {
    ++this.generation
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(new Error('连接已关闭，未完成请求已取消'))
      this.pending = undefined
    }
    const transport = this.transport
    this.transport = undefined
    await transport?.disconnect()
  }
}
