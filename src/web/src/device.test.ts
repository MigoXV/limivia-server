import { describe, expect, it, vi } from 'vitest'
import { DeviceClient, LineReader, type Transport } from './device'

class MockTransport implements Transport {
  writes: string[] = []
  onData: (text: string) => void = () => {}
  onClose: () => void = () => {}
  respond = true
  async connect(data: (text: string) => void, close: () => void) {
    this.onData = data
    this.onClose = close
  }
  async disconnect() {}
  async write(bytes: Uint8Array) {
    const text = new TextDecoder().decode(bytes)
    this.writes.push(text)
    const request = JSON.parse(text)
    if (!this.respond) return
    const result =
      request.op === 'hello'
        ? { protocol: 1, board: 'luatos-esp32c3-usb', state: { pins: [] } }
        : { executed: true }
    const reply = JSON.stringify({ v: 1, id: request.id, ok: true, result }) + '\n'
    this.onData(reply.slice(0, 8))
    this.onData(reply.slice(8))
  }
}

describe('line framing', () => {
  it('handles fragmented messages, multiple lines and CRLF', () => {
    const lines: string[] = []
    const parser = new LineReader((line) => lines.push(line))
    parser.push('{"v":')
    parser.push('1}\r\n{"v":1}\n')
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ v: 1 }, { v: 1 }])
  })
  it('discards entire oversized frame and recovers at delimiter', () => {
    const lines: string[] = []
    const parser = new LineReader((line) => lines.push(line), 4)
    parser.push('123456')
    parser.push('7\nok\n')
    expect(lines).toEqual(['ok'])
  })
})
describe('device lifecycle', () => {
  it('handshakes and serializes requests', async () => {
    const transport = new MockTransport()
    const client = new DeviceClient()
    await client.connect('usb', transport)
    await Promise.all([client.request('state'), client.request('gpio.read', { pin: 13 })])
    expect(transport.writes.map((text) => JSON.parse(text).op)).toEqual([
      'hello',
      'state',
      'gpio.read',
    ])
    await client.disconnect()
  })
  it('does not retry a timed out write and ignores unrelated responses', async () => {
    vi.useFakeTimers()
    const transport = new MockTransport()
    const client = new DeviceClient()
    await client.connect('ble', transport)
    transport.respond = false
    const request = client.request('gpio.set', { pin: 13 })
    const failure = expect(request).rejects.toThrow('操作可能已执行')
    await Promise.resolve()
    transport.onData('{"v":1,"id":999,"ok":true,"result":{}}\n')
    await vi.advanceTimersByTimeAsync(6001)
    await failure
    expect(transport.writes.length).toBe(2)
    await client.disconnect()
    vi.useRealTimers()
  })
  it('disconnect cancels pending and queued writes', async () => {
    const transport = new MockTransport()
    const client = new DeviceClient()
    await client.connect('usb', transport)
    transport.respond = false
    const first = client.request('state')
    const second = client.request('gpio.set', { pin: 13 })
    const firstFailure = expect(first).rejects.toThrow('连接已关闭')
    const secondFailure = expect(second).rejects.toThrow('设备已断开')
    await Promise.resolve()
    await client.disconnect()
    await firstFailure
    await secondFailure
    expect(transport.writes.length).toBe(2)
  })
  it('surfaces firmware errors and supports subsequent recovery', async () => {
    const transport = new MockTransport()
    const client = new DeviceClient()
    await client.connect('usb', transport)
    transport.respond = false
    const request = client.request('gpio.set', { pin: 18 })
    const failure = expect(request).rejects.toThrow('保留')
    await Promise.resolve()
    transport.onData('{"v":1,"id":2,"ok":false,"error":{"code":"protected_pin"}}\n')
    await failure
    transport.respond = true
    expect(await client.request('state')).toEqual({ executed: true })
    await client.disconnect()
  })
})
