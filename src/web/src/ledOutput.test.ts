import { describe, expect, it } from 'vitest'
import { initialState, type DeviceState, type Resource } from './device'
import { confirmedLedOutput } from './ledOutput'

const identity = {
  board: 'luatos-esp32c3-usb',
  device_id: 'device',
  boot_id: 'boot',
  build_id: 'build',
  profile: 'unknown-profile',
  firmware: 'test',
  protocol: 3,
  contract: 'limivia-v3-jsonrpc2',
  jsonrpc: '2.0',
  batch_max: 8,
}
const resource: Resource = {
  id: 1,
  instance: 10,
  kind: 'gpio',
  state: 'ready',
  parent: 0,
  pin_mask: 2 ** 13,
  definition: { config: { mode: 'output' } },
  driver_error: 0,
  cleanup_error: 0,
}
const state: DeviceState = {
  ...initialState,
  identity,
  status: 'ready',
  stale: false,
  resource_values: { '1': { level: 0 } },
}
const project = (
  previous: ReturnType<typeof confirmedLedOutput>,
  nextState = state,
  nextResource: Resource | undefined = resource,
  online = true,
  busy = false,
  invalid = false,
) => confirmedLedOutput(previous, nextState, nextResource, online, busy, invalid)

describe('LED recently confirmed presentation', () => {
  it('retains confirmed output through pending commands and snapshot refresh, then updates once', () => {
    const off = project(null)
    expect(off?.output).toBe('off')
    const onState = { ...state, resource_values: { '1': { level: 1 } } }
    expect(project(off, onState, resource, true, true)).toBe(off)
    expect(project(off, { ...onState, stale: true })).toBe(off)
    const on = project(off, onState)
    expect(on?.output).toBe('on')
    expect(project(on, onState)).toBe(on)
  })
  it('does not invent a first confirmation from stale data or from an accepted command', () => {
    expect(project(null, { ...state, stale: true })).toBeNull()
    expect(project(null, state, resource, true, true)).toBeNull()
    expect(project(null, { ...state, resource_values: {} })).toBeNull()
  })
  it('invalidates on disconnect, unknown result, resource closure and faults', () => {
    const off = project(null)
    expect(project(off, state, resource, false)).toBeNull()
    expect(project(off, { ...state, status: 'disconnected' })).toBeNull()
    expect(project(off, state, resource, true, false, true)).toBeNull()
    expect(confirmedLedOutput(off, state, undefined, true, false, false)).toBeNull()
    expect(project(off, state, { ...resource, state: 'closing' })).toBeNull()
    expect(project(off, state, { ...resource, state: 'fault' })).toBeNull()
  })
  it('never carries a previous value into a new connection, boot or resource instance', () => {
    const off = project(null)
    const stale = { ...state, stale: true }
    expect(project(off, { ...stale, generation: state.generation + 1 })).toBeNull()
    expect(project(off, { ...stale, identity: { ...identity, boot_id: 'new-boot' } })).toBeNull()
    expect(project(off, stale, { ...resource, instance: 11 })).toBeNull()
    expect(project(off, stale, { ...resource, id: 2 })).toBeNull()
  })
  it('requires an enabled PWM readback before presenting configured breathing', () => {
    const pwm = { ...resource, kind: 'pwm', definition: { config: { breath_ms: 2000 } } }
    expect(project(null, state, pwm)).toBeNull()
    expect(
      project(null, { ...state, resource_values: { '1': { enabled: true } } }, pwm)?.output,
    ).toBe('breath')
  })
})
