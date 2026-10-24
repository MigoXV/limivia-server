import { kindDescriptions, kindNames, type DeviceState } from './device'

export type ResourceView =
  | { type: 'led' }
  | { type: 'create'; kind: string }
  | { type: 'resource'; id: number; instance: number }
export interface PeripheralEntry {
  id: string
  name: string
  description: string
  available: boolean
  reason: string
  view: ResourceView
}
export function peripheralEntries(state: DeviceState): PeripheralEntry[] {
  if (!state.discovery) return []
  const gpio = state.discovery.resources.find((c) => c.kind === 'gpio' && c.available)
  const board = state.identity?.board === 'luatos-esp32c3-usb'
  const ledAvailable =
    board &&
    !!gpio?.actions.some((a) => a.action === 'write') &&
    state.discovery.pins.some((pin) => pin.pin === 13 && pin.digital)
  return [
    {
      id: 'led',
      name: '板载 LED',
      description: 'D5 · GPIO13 · 无需外部接线',
      available: ledAvailable,
      reason: !board
        ? '当前板型未提供已确认的板载灯映射'
        : '当前固件未开放板载灯所需的 GPIO13 输出',
      view: { type: 'led' },
    },
    ...state.discovery.resources.map((c) => ({
      id: c.kind,
      name: kindNames[c.kind] ?? c.kind,
      description: kindDescriptions[c.kind] ?? `容量 ${c.capacity}`,
      available: c.available,
      reason: '当前固件未提供此能力',
      view: { type: 'create' as const, kind: c.kind },
    })),
  ]
}
export function resourceViewKey(view: ResourceView | null) {
  return !view
    ? ''
    : view.type === 'led'
      ? 'led'
      : view.type === 'create'
        ? `create:${view.kind}`
        : `resource:${view.id}:${view.instance}`
}
