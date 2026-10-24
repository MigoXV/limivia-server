import { type Args, type DeviceState, type Capability } from './device'
import { BOARD_PINS } from './board'
export interface WiringGroup {
  id: string
  name: string
  kind: string
  pins: Record<string, number>
  config: Args
  parent_group: string | null
  controller: number | null
  support_pins: string[]
  notes: string
}
export interface WiringPlan {
  schema_version: 1
  board: string
  revision: number
  title: string
  groups: WiringGroup[]
}
export interface WiringBinding {
  boot_id: string
  resource: number
  instance: number
  definition: Args
  plan_revision: number
}
export type BoardSelection =
  | { type: 'pin'; id: string }
  | { type: 'group'; id: string }
  | { type: 'resource'; id: number; instance: number }
  | { type: 'internal' }
  | null
export function initialBoardSelection(state: DeviceState): BoardSelection {
  if (
    state.status !== 'ready' ||
    state.identity?.board !== 'luatos-esp32c3-usb' ||
    !state.discovery?.pins.some((p) => p.pin === 13 && p.digital) ||
    !state.discovery.resources.some((c) => c.available && ['gpio', 'pwm'].includes(c.kind))
  )
    return null
  return { type: 'pin', id: BOARD_PINS.find((p) => p.gpio === 13)!.id }
}
export const pinRoles = (cap: Capability) => cap.pin_roles.match(/[a-zA-Z_][\w.]*/g) ?? []
export function groupPins(
  group: WiringGroup,
  groups: WiringGroup[],
  seen = new Set<string>(),
): number[] {
  if (seen.has(group.id)) return []
  seen.add(group.id)
  const parent = groups.find((g) => g.id === group.parent_group)
  return [
    ...new Set([...Object.values(group.pins), ...(parent ? groupPins(parent, groups, seen) : [])]),
  ]
}
export function pinFunctions(state: DeviceState, gpio: number) {
  const physical = BOARD_PINS.find((p) => p.gpio === gpio)
  const pin = state.discovery?.pins.find((p) => p.pin === gpio)
  if (!physical || physical.protected || !pin) return []
  return (
    state.discovery?.resources.filter(
      (c) =>
        c.available && pinRoles(c).length && (c.kind.startsWith('adc') ? pin.adc1 : pin.digital),
    ) ?? []
  )
}
export function newGroup(cap: Capability, gpio?: number, role?: string): WiringGroup {
  const defaults: Args = {
    mode: cap.kind === 'gpio' ? 'input' : 'uart',
    pull: 'none',
    frequency: 1000,
    resolution: 10,
    duty: 50,
    interval_ms: 500,
    high_ms: 500,
    low_ms: 500,
    count: 0,
    baud: 115200,
  }
  const config: Args = {}
  for (const field of cap.config) {
    const value = defaults[field.name]
    if (
      value !== undefined &&
      !(typeof value === 'string' && field.values && !field.values.split(',').includes(value))
    )
      config[field.name] =
        typeof value === 'number'
          ? Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value))
          : value
  }
  return {
    id: crypto.randomUUID(),
    name: '',
    kind: cap.kind,
    pins: gpio === undefined || !role ? {} : { [role]: gpio },
    config,
    parent_group: null,
    controller: null,
    support_pins: [],
    notes: '',
  }
}
