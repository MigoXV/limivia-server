import type { Args, DeviceState, Resource } from './device'

// Presentation memory only: a confirmed output is never a desired/optimistic value.
export interface ConfirmedLedOutput {
  key: string
  output: 'on' | 'off' | 'breath' | 'pwm'
}
export function ledOutputKey(state: DeviceState, resource?: Resource) {
  return [
    state.generation,
    state.identity?.device_id,
    state.identity?.boot_id,
    state.identity?.build_id,
    resource?.id,
    resource?.instance,
    resource?.kind,
  ].join(':')
}
export function confirmedLedOutput(
  previous: ConfirmedLedOutput | null,
  state: DeviceState,
  resource: Resource | undefined,
  online: boolean,
  busy: boolean,
  invalid: boolean,
): ConfirmedLedOutput | null {
  if (
    !online ||
    state.status !== 'ready' ||
    invalid ||
    resource?.state !== 'ready' ||
    state.identity?.board !== 'luatos-esp32c3-usb'
  )
    return null
  const key = ledOutputKey(state, resource)
  const retained = previous?.key === key ? previous : null
  if (busy || state.stale) return retained
  const value = state.resource_values[resource.id]
  const config = resource.definition.config as Args | undefined
  const output =
    resource.kind === 'gpio' && (value?.level === 0 || value?.level === 1)
      ? value.level === 1
        ? 'on'
        : 'off'
      : resource.kind === 'pwm' && value?.enabled === true
        ? Number(config?.breath_ms) > 0
          ? 'breath'
          : 'pwm'
        : null
  if (!output) return retained
  return retained?.output === output ? retained : { key, output }
}
