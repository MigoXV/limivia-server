import type { Page, WebSocketRoute } from '@playwright/test'

// Test-only backend simulation. Production always talks to the Python device service.
export async function installDevice(page: Page, kind: 'usb' | 'ble') {
  await page.route('**/api/device/discover?*', async (route) => {
    await route.fulfill({ json: { kind, devices: [{ id: 'test-device', name: 'LIMIVIA test' }] } })
  })
  let socket: WebSocketRoute | undefined
  const pins = [0, 1, 3, 4, 5, 6, 7, 10, 13, 20, 21].map((pin) => ({
    pin,
    mode: 'idle',
    pull: 'none',
    level: null as number | null,
  }))
  const state = {
    revision: 0,
    uptime_ms: 1000,
    ble_connected: kind === 'ble',
    usb_active: kind === 'usb',
    pins,
    pwm: [] as {
      pin: number
      frequency: number
      duty: number
      resolution: number
      breath_ms: number
    }[],
    timers: [] as {
      id: number
      pin: number
      kind: string
      high_ms: number
      low_ms: number
      count: number
      elapsed_ms: number
    }[],
    streams: [] as { pin: number; interval_ms: number }[],
  }
  let receive: (text: string) => void = () => {}
  let buffer = ''
  const commands: string[] = []
  let delayOp = ''
  let rejectOp = ''
  let rejectCode = 'pin_busy'
  let dropOp = ''
  let delayed: (() => void) | undefined
  let timerId = 0
  function send(text: string) {
    for (let n = 0; n < text.length; n += 17) receive(text.slice(n, n + 17))
  }
  const decoder = new TextDecoder()
  function write(bytes: Uint8Array) {
    buffer += decoder.decode(bytes, { stream: true })
    for (;;) {
      const boundary = buffer.indexOf('\n')
      if (boundary < 0) return
      const line = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 1)
      const { id, op, params } = JSON.parse(line)
      commands.push(op)
      if (op === rejectOp) {
        rejectOp = ''
        queueMicrotask(() =>
          send(JSON.stringify({ v: 1, id, ok: false, error: { code: rejectCode } }) + '\n'),
        )
        continue
      }
      const target = pins.find((pin) => pin.pin === params.pin)
      let result: unknown = state
      state.revision++
      state.uptime_ms += 100
      if (op === 'hello')
        result = {
          name: 'LIMIVIA',
          board: 'luatos-esp32c3-usb',
          firmware: '0.1.0',
          device_id: 'test-device',
          protocol: 1,
          state,
          capabilities: {
            features: ['ble', 'led', 'gpio', 'pwm', 'adc', 'timer'],
            max_pwm: 4,
            max_timers: 4,
            status_led: 12,
            demo_led: 13,
            adc_max_mv: 2500,
            adc_calibrated: true,
          },
        }
      if (op === 'gpio.set' && target) {
        target.mode = params.mode
        target.pull = params.pull
        target.level = params.level
      }
      if (op === 'pwm.set' && target) {
        target.mode = 'pwm'
        target.level = null
        state.pwm = [
          ...state.pwm.filter((p) => p.pin !== params.pin),
          { ...params, resolution: 14 },
        ]
      }
      if (op === 'timer.start' && target) {
        target.mode = 'timer'
        state.timers = [...state.timers, { ...params, id: ++timerId, elapsed_ms: 0 }]
      }
      if (op === 'adc.read' || op === 'adc.start') {
        if (target) target.mode = 'adc'
        result = {
          pin: params.pin,
          raw: 2048,
          millivolts: 1500,
          calibrated: true,
          uptime_ms: state.uptime_ms,
        }
        if (op === 'adc.start')
          state.streams = [...state.streams.filter((p) => p.pin !== params.pin), params]
      }
      if (['pin.release', 'pwm.stop', 'timer.stop', 'adc.stop', 'outputs.stop'].includes(op)) {
        const all = op === 'outputs.stop'
        for (const p of pins)
          if (all || p.pin === params.pin) {
            p.mode = 'idle'
            p.pull = 'none'
            p.level = null
          }
        state.pwm = state.pwm.filter((p) => !all && p.pin !== params.pin)
        state.timers = state.timers.filter((p) => !all && p.pin !== params.pin)
        state.streams = state.streams.filter((p) => !all && p.pin !== params.pin)
      }
      const response = JSON.stringify({ v: 1, id, ok: true, result }) + '\n'
      if (op === dropOp) {
        dropOp = ''
        continue
      }
      if (op === delayOp) {
        delayOp = ''
        delayed = () => send(response)
        continue
      }
      // Responses deliberately span multiple packets.
      queueMicrotask(() => {
        send(response)
      })
    }
  }
  await page.routeWebSocket('**/api/device/connect?*', (ws) => {
    socket = ws
    receive = (data) => ws.send(JSON.stringify({ type: 'data', data }))
    ws.onMessage((data) => write(new TextEncoder().encode(String(data))))
    ws.send(JSON.stringify({ type: 'connected' }))
  })
  return {
    commands,
    delayNext(op: string) {
      delayOp = op
    },
    acknowledge() {
      delayed?.()
      delayed = undefined
    },
    dropNext(op: string) {
      dropOp = op
    },
    rejectNext(op: string, code = 'pin_busy') {
      rejectOp = op
      rejectCode = code
    },
    sample(pin: number, raw: number, millivolts: number | null = null) {
      receive(
        JSON.stringify({
          v: 1,
          event: 'adc',
          data: {
            pin,
            raw,
            millivolts,
            calibrated: millivolts !== null,
            uptime_ms: ++state.uptime_ms,
          },
        }) + '\n',
      )
    },
    disconnect() {
      socket?.send(JSON.stringify({ type: 'error', message: '后端设备连接已断开，请重新连接。' }))
      socket?.close()
    },
  }
}
