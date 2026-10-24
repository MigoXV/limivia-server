import { describe, expect, it } from 'vitest'
import { initialState, type Capability, type DeviceState } from './device'
import { peripheralEntries, resourceViewKey } from './peripherals'
const identity = {
  board: 'luatos-esp32c3-usb',
  device_id: 'test',
  boot_id: 'boot',
  build_id: 'build',
  profile: 'arbitrary-profile',
  firmware: 'test',
  protocol: 3,
  contract: 'limivia-v3-jsonrpc2',
  jsonrpc: '2.0',
  batch_max: 8,
}
const gpio: Capability = {
  kind: 'gpio',
  available: true,
  capacity: 11,
  pin_roles: 'pin',
  required_pins: 'pin',
  config: [],
  actions: [{ action: 'write', args: [] }],
}
const state: DeviceState = {
  ...initialState,
  identity,
  status: 'ready',
  stale: false,
  discovery: {
    identity,
    pins: [{ pin: 13, digital: true, adc1: false, deep_sleep_wake: false }],
    resources: [gpio, { ...gpio, kind: 'pwm', available: false }],
    operations: [],
    raw_pages: [],
  },
}
describe('peripheral catalog projection', () => {
  it('uses real firmware availability and includes the board LED as a peer entry', () => {
    const entries = peripheralEntries(state)
    expect(entries.map((entry) => [entry.id, entry.available])).toEqual([
      ['led', true],
      ['gpio', true],
      ['pwm', false],
    ])
    expect(peripheralEntries({ ...state, stale: true })).toEqual(entries)
  })
  it('does not fabricate unavailable peripherals before discovery', () =>
    expect(peripheralEntries(initialState)).toEqual([]))
  it('requires a confirmed board and output pin for the LED but not PWM capability', () => {
    expect(
      peripheralEntries({ ...state, identity: { ...identity, board: 'different-board' } })[0]
        .available,
    ).toBe(false)
    expect(
      peripheralEntries({ ...state, discovery: { ...state.discovery!, pins: [] } })[0].available,
    ).toBe(false)
    expect(peripheralEntries(state)[0].available).toBe(true)
  })
  it('keeps selections distinct across kind and resource instance', () => {
    expect(resourceViewKey({ type: 'led' })).not.toBe(
      resourceViewKey({ type: 'create', kind: 'gpio' }),
    )
    expect(resourceViewKey({ type: 'resource', id: 1, instance: 2 })).not.toBe(
      resourceViewKey({ type: 'resource', id: 1, instance: 3 }),
    )
  })
})
