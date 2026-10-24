import type { DeviceState } from './device'

export type Section = 'home' | 'flow' | 'network' | 'files' | 'maintenance'

export function navigationReason(section: Section, state: DeviceState): string {
  if (section === 'home') return ''
  if (!state.discovery || !state.identity || state.status !== 'ready') return '待识别'
  const operations = state.discovery.operations.filter((operation) => operation.available)
  const supports = (...groups: string[]) =>
    operations.some((operation) => groups.includes(operation.op.split('.')[0]))
  const available =
    section === 'flow'
      ? supports('flow')
      : section === 'files'
        ? supports('storage')
        : section === 'network'
          ? supports('wifi', 'mqtt', 'espnow')
          : supports('system', 'power', 'ota', 'diagnostics', 'buffer', 'gpio', 'rmt', 'job', 'mux')
  return available ? '' : '未提供'
}
