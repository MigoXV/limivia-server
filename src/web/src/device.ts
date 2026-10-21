export const SERVICE = '7b9d0001-7a21-4c9b-8b30-69e5ce1d0001'
export const RX = '7b9d0002-7a21-4c9b-8b30-69e5ce1d0001'
export const TX = '7b9d0003-7a21-4c9b-8b30-69e5ce1d0001'
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
  connect(onData: (text: string) => void, onClose: () => void): Promise<void>
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

class SerialTransport implements Transport {
  private port?: SerialPort
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private writer?: WritableStreamDefaultWriter<Uint8Array>
  private reading?: Promise<void>
  private closing = false
  async connect(onData: (text: string) => void, onClose: () => void) {
    this.port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: 0x303a, usbProductId: 0x1001 }],
    })
    await this.port.open({ baudRate: 115200, bufferSize: 16384 })
    if (!this.port.readable || !this.port.writable) throw new Error('串口未提供读写通道')
    this.writer = this.port.writable.getWriter()
    this.reader = this.port.readable.getReader()
    const decoder = new TextDecoder()
    this.reading = (async () => {
      try {
        while (!this.closing) {
          const { value, done } = await this.reader!.read()
          if (done) break
          if (value) onData(decoder.decode(value, { stream: true }))
        }
      } catch {
        /* disconnect is reported below */
      } finally {
        this.reader?.releaseLock()
        this.reader = undefined
        if (!this.closing) onClose()
      }
    })()
  }
  async write(data: Uint8Array) {
    if (!this.writer) throw new Error('USB 连接已关闭')
    await this.writer.write(data)
  }
  async disconnect() {
    this.closing = true
    await this.reader?.cancel().catch(() => {})
    await this.reading
    this.writer?.releaseLock()
    this.writer = undefined
    await this.port?.close().catch(() => {})
    this.port = undefined
  }
}

class BluetoothTransport implements Transport {
  private device?: BluetoothDevice
  private rx?: BluetoothRemoteGATTCharacteristic
  private tx?: BluetoothRemoteGATTCharacteristic
  private closeHandler?: () => void
  private dataHandler?: EventListener
  async connect(onData: (text: string) => void, onClose: () => void) {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] })
    this.closeHandler = onClose
    this.device.addEventListener('gattserverdisconnected', onClose)
    const server = await this.device.gatt?.connect()
    if (!server) throw new Error('蓝牙 GATT 连接失败')
    const service = await server.getPrimaryService(SERVICE)
    this.rx = await service.getCharacteristic(RX)
    this.tx = await service.getCharacteristic(TX)
    const decoder = new TextDecoder()
    this.dataHandler = () => {
      const value = this.tx?.value
      if (value) onData(decoder.decode(value, { stream: true }))
    }
    this.tx.addEventListener('characteristicvaluechanged', this.dataHandler)
    await this.tx.startNotifications()
  }
  async write(data: Uint8Array) {
    if (!this.rx) throw new Error('BLE 连接已关闭')
    // 20 bytes works at the mandatory ATT MTU, including browsers that hide MTU.
    for (let offset = 0; offset < data.length; offset += 20) {
      await this.rx.writeValueWithResponse(data.slice(offset, offset + 20))
    }
  }
  async disconnect() {
    if (this.dataHandler)
      this.tx?.removeEventListener('characteristicvaluechanged', this.dataHandler)
    if (this.closeHandler)
      this.device?.removeEventListener('gattserverdisconnected', this.closeHandler)
    this.device?.gatt?.disconnect()
    this.rx = undefined
    this.tx = undefined
    this.device = undefined
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
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError') return '已取消设备选择，或未发现匹配的设备。'
    if (error.name === 'SecurityError' || error.name === 'NotAllowedError')
      return '浏览器未授予设备权限，请在站点设置中检查权限后重新连接。'
    if (error.name === 'NetworkError')
      return '设备连接失败。检查 USB 占用、蓝牙状态与设备供电后重试。'
  }
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
  onClose: () => void = () => {}
  setHandlers(handlers: {
    onLog?: (direction: string, text: string) => void
    onClose?: () => void
    onEvent?: (message: Message) => void
  }) {
    this.onLog = handlers.onLog ?? (() => {})
    this.onClose = handlers.onClose ?? (() => {})
    this.onEvent = handlers.onEvent ?? (() => {})
  }
  get busy() {
    return this.pending !== undefined
  }
  async connect(kind: LinkKind, transport?: Transport): Promise<Hello> {
    if (this.transport) throw new Error('请先断开当前设备')
    const gen = ++this.generation
    this.transport =
      transport ?? (kind === 'usb' ? new SerialTransport() : new BluetoothTransport())
    const parser = new LineReader((line) => {
      if (gen === this.generation) this.receive(line)
    })
    try {
      await this.transport.connect(
        (text) => parser.push(text),
        () => {
          if (gen !== this.generation) return
          void this.disconnect()
          this.onClose()
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
