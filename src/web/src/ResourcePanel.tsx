import { label } from './fieldLabels'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  kindNames,
  actionNames,
  adcSamples,
  saveBlob,
  type Args,
  type Capability,
  type DeviceState,
  type Resource,
} from './device'
import { Action, Fields, Result } from './Forms'
import { LedPanel } from './LedPanel'
import { Chart } from './WorkbenchUI'
import { peripheralEntries, resourceViewKey, type ResourceView } from './peripherals'
const defaults: Args = {
  frequency: 1000,
  resolution: 10,
  duty: 50,
  pull: 'none',
  level: 0,
  interval_ms: 500,
  high_ms: 500,
  low_ms: 500,
  count: 0,
  baud: 115200,
}
export function ResourcePanel({
  state,
  enabled,
  online,
  view,
  onViewChange,
}: {
  state: DeviceState
  enabled: boolean
  online: boolean
  view: ResourceView | null
  onViewChange: (view: ResourceView) => void
}) {
  const entries = peripheralEntries(state)
  const available = entries.filter((entry) => entry.available)
  const unavailable = entries.filter((entry) => !entry.available)
  const selectedView = view ?? available[0]?.view ?? null
  const selectedKey = resourceViewKey(selectedView)
  const selected =
    selectedView?.type === 'create'
      ? state.discovery?.resources.find((c) => c.kind === selectedView.kind)
      : undefined
  const resource =
    selectedView?.type === 'resource'
      ? state.snapshot?.resources.find(
          (r) => r.id === selectedView.id && r.instance === selectedView.instance,
        )
      : undefined
  const detail = useRef<HTMLElement>(null)
  useEffect(() => {
    detail.current?.scrollTo({ top: 0 })
  }, [selectedKey])
  return (
    <>
      <div className="page-heading">
        <h1>外设调试</h1>
        <span>当前固件 · {state.identity?.profile ?? '尚未连接'}</span>
      </div>
      <div className="peripheral-workspace">
        <aside className="peripheral-catalog" aria-label="外设功能" tabIndex={0}>
          <h2>外设功能</h2>
          <p className="muted">按当前固件能力展示</p>
          <div className="peripheral-entries">
            {available.map((entry) => (
              <button
                key={entry.id}
                className="peripheral-entry"
                aria-label={entry.name}
                aria-pressed={
                  selectedView?.type === 'resource'
                    ? resource?.kind === entry.id
                    : selectedKey === resourceViewKey(entry.view)
                }
                aria-controls="peripheral-detail"
                onClick={() => onViewChange(entry.view)}
              >
                <strong>{entry.name}</strong>
                <small>{entry.description}</small>
              </button>
            ))}
          </div>
          {!entries.length && <p className="muted">连接设备并读取能力后显示可用外设。</p>}
          {!!unavailable.length && (
            <details className="peripheral-unavailable">
              <summary>当前不可用（{unavailable.length}）</summary>
              {unavailable.map((entry) => (
                <div className="peripheral-unavailable-entry" key={entry.id} aria-disabled="true">
                  <strong>{entry.name}</strong>
                  <small>{entry.reason}</small>
                </div>
              ))}
            </details>
          )}
        </aside>
        <section
          id="peripheral-detail"
          className="peripheral-detail"
          ref={detail}
          tabIndex={0}
          aria-label="外设详情"
        >
          {selectedView?.type === 'led' ? (
            <LedPanel state={state} enabled={enabled} online={online} />
          ) : selectedView?.type === 'resource' ? (
            resource ? (
              <>
                <h2>调试 {kindNames[resource.kind] ?? resource.kind}</h2>
                <ResourceActions
                  key={`${state.generation}:${resource.id}:${resource.instance}`}
                  resource={resource}
                  capability={state.discovery?.resources.find((c) => c.kind === resource.kind)}
                  enabled={enabled}
                  state={state}
                />
              </>
            ) : (
              <div className="peripheral-empty">
                <h2>该资源已释放或已更换实例</h2>
                <p>从左侧列表选择功能，或从主导航选择现有资源。</p>
              </div>
            )
          ) : selected?.available ? (
            <>
              <h2>新建 {kindNames[selected.kind] ?? selected.kind} 外设</h2>
              <ResourceCreate
                key={`${state.generation}:${selected.kind}`}
                capability={selected}
                state={state}
                enabled={enabled}
                onOpened={(id, instance) => onViewChange({ type: 'resource', id, instance })}
              />
            </>
          ) : (
            <div className="peripheral-empty">
              <h2>{selectedView ? '当前功能不可用' : '当前没有可用外设'}</h2>
              <p>可用功能以固件能力发现为准。</p>
            </div>
          )}
          <details className="peripheral-snapshot">
            <summary>当前一致快照</summary>
            <Result value={state.snapshot} />
          </details>
        </section>
      </div>
    </>
  )
}
export function ResourceCreate({
  capability,
  state,
  enabled,
  onOpened,
}: {
  capability: Capability
  state: DeviceState
  enabled: boolean
  onOpened?: (id: number, instance: number) => void
}) {
  const [config, setConfig] = useState<Args>(() => {
    const values: Args = { ...defaults }
    if (capability.kind === 'gpio') values.mode = 'input'
    if (capability.kind === 'uart') values.mode = 'uart'
    return Object.fromEntries(
      capability.config
        .filter((p) => values[p.name] !== undefined)
        .map((p) => [
          p.name,
          typeof values[p.name] === 'number'
            ? Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, Number(values[p.name])))
            : values[p.name],
        ]),
    )
  })
  const [pins, setPins] = useState<Args>({})
  const [parent, setParent] = useState('')
  const [controller, setController] = useState('')
  const [checked, setChecked] = useState('')
  const [result, setResult] = useState<unknown>(null)
  const roles: string[] = capability.pin_roles.match(/[a-zA-Z_][\w.]*/g) ?? []
  const required: string[] = capability.required_pins.match(/[a-zA-Z_][\w.]*/g) ?? []
  const draft = {
    kind: capability.kind,
    pins,
    config,
    ...(parent ? { parent: Number(parent) } : {}),
    ...(controller ? { controller: Number(controller) } : {}),
  }
  const key = JSON.stringify(draft)
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <h3>配置资源</h3>
      <p className="muted">3.3V 逻辑 · GPIO13 接有板载 LED · 保护和复用以本次预检为准</p>
      <div className="fields">
        {roles.map((role) => (
          <label className="field" key={role}>
            {label(role)}
            {required.includes(role) ? ' *' : ''}
            <select
              aria-label={label(role) + (required.includes(role) ? ' *' : '')}
              value={String(pins[role] ?? '')}
              required={required.includes(role)}
              onChange={(e) => {
                const next = { ...pins }
                if (e.target.value === '') delete next[role]
                else next[role] = Number(e.target.value)
                setPins(next)
              }}
            >
              <option value="">未分配</option>
              {state.discovery?.pins
                .filter((p) => (capability.kind.startsWith('adc') ? p.adc1 : p.digital))
                .map((p) => (
                  <option key={p.pin} value={p.pin}>
                    GPIO {p.pin}
                    {p.pin === 13 ? ' · D5 LED' : ''}
                  </option>
                ))}
            </select>
          </label>
        ))}
        {['i2c.device', 'spi.device'].includes(capability.kind) && (
          <label className="field">
            父总线 *
            <select required value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">请选择</option>
              {state.snapshot?.resources
                .filter(
                  (r) =>
                    r.kind === capability.kind.replace('device', 'master') && r.state === 'ready',
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    #{r.id} {kindNames[r.kind]}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="field">
          控制器（可选）
          <input
            type="number"
            min="0"
            value={controller}
            onChange={(e) => setController(e.target.value)}
          />
        </label>
      </div>
      <Fields fields={capability.config} value={config} onChange={setConfig} />
      <div className="row">
        <Action
          disabled={!state.identity}
          run={async () => {
            const task = await api.run('resource.preflight', draft)
            setResult(task.result)
            setChecked(key)
          }}
        >
          检查引脚与资源
        </Action>
        <Action
          primary
          disabled={!enabled || checked !== key}
          run={async () => {
            const scope = api.deviceScope()
            const task = await api.run('resource.open', draft, scope)
            setResult(task.result ?? task.job)
            const id = Number(task.job?.resource ?? task.result?.resource ?? 0)
            if (id && onOpened) {
              const confirmed = await api.run('resource.get', { resource: id }, scope)
              const instance = Number(confirmed.result?.instance)
              if (!Number.isInteger(instance) || instance < 1)
                throw new Error('资源已创建，但尚未取得有效实例，请从资源列表核对。')
              onOpened(id, instance)
            }
          }}
        >
          创建{kindNames[capability.kind] ?? capability.kind}
        </Action>
      </div>
      <p role="status">
        {checked === key ? '当前预检通过；资源尚未预留。' : '编辑后请先进行预检。'}
      </p>
      <Result value={result} />
      <details>
        <summary>设备原始能力描述</summary>
        <Result value={capability} />
      </details>
    </form>
  )
}
function ResourceActions({
  resource,
  capability,
  enabled,
  state,
}: {
  resource: Resource
  capability?: Capability
  enabled: boolean
  state: DeviceState
}) {
  const [action, setAction] = useState('status')
  const [args, setArgs] = useState<Args>({})
  const [result, setResult] = useState<unknown>(null)
  const fields = capability?.actions.find((a) => a.action === action)?.args ?? []
  const actions = capability?.actions ?? []
  const pin = Number((resource.definition.pins as Args)?.pin ?? 0)
  const samples = useMemo(() => {
    if (resource.kind !== 'adc') return []
    try {
      return adcSamples({ events: state.samples?.[resource.id] ?? [] }, pin, resource.instance)
    } catch {
      return []
    }
  }, [state.samples, resource.id, resource.instance, resource.kind, pin])
  const collect = state.sampling?.includes(String(resource.id))
  return (
    <>
      <div className="toolbar">
        <h2>
          #{resource.id} · {kindNames[resource.kind] ?? resource.kind}
        </h2>
        <span>{resource.state}</span>
      </div>
      <p>
        {resource.state === 'fault'
          ? '故障资源仍占用引脚；恢复动作会重试关闭。'
          : '配置是设备已确认的定义。'}
      </p>
      <Result value={resource.definition} />
      <div className="fields">
        <label className="field">
          资源操作
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setArgs({})
            }}
          >
            <option value="status">status · 读取状态</option>
            {actions
              .filter((a) => a.action !== 'status')
              .map((a) => (
                <option key={a.action} value={a.action}>
                  {actionNames[a.action] ?? a.action} · {a.action}
                </option>
              ))}
          </select>
        </label>
      </div>
      <Fields fields={fields} value={args} onChange={setArgs} />
      <div className="row">
        <Action
          disabled={!enabled}
          primary
          run={async () => {
            const task = await api.run('resource.call', { resource: resource.id, action, args })
            setResult(task.result)
          }}
        >
          执行操作
        </Action>
        <Action
          run={async () =>
            setResult((await api.run('resource.get', { resource: resource.id })).result)
          }
        >
          查询资源
        </Action>
        {resource.kind === 'adc' && (
          <button
            disabled={!enabled}
            onClick={() => {
              void api.request(
                `/api/device/resources/${resource.id}/sampling?enabled=${!collect}`,
                'POST',
              )
            }}
          >
            {collect ? '停止读取队列' : '连续读取采样'}
          </button>
        )}
        <Action
          disabled={!enabled}
          run={async () => {
            if (!confirm('关闭该资源？存在子资源时将单独提示，未确认清理前仍视为占用。')) return
            setResult(
              (
                await api.run(resource.state === 'fault' ? 'resource.recover' : 'resource.close', {
                  resource: resource.id,
                })
              ).result,
            )
          }}
        >
          {resource.state === 'fault' ? '重试关闭' : '关闭资源'}
        </Action>
        <Action
          disabled={!enabled}
          run={async () => {
            if (confirm('级联关闭该父资源和全部子资源？此操作会影响整个资源树。'))
              setResult(
                (await api.run('resource.close', { resource: resource.id, cascade: true })).result,
              )
          }}
        >
          级联关闭…
        </Action>
      </div>
      {resource.kind === 'adc' && (
        <>
          <Chart samples={samples} stale={state.stale || state.status !== 'ready'} />
          <button
            disabled={!samples.length}
            onClick={() =>
              saveBlob(
                new Blob([
                  'sequence,raw,millivolts\n' +
                    samples.map((s) => `${s.sequence},${s.raw},${s.millivolts ?? ''}`).join('\n'),
                ]),
                'adc.csv',
              )
            }
          >
            导出采样 CSV
          </button>
        </>
      )}
      <Result value={result} format={resource.kind} />
      <p className="muted">
        周期 ADC 的 raw/mV 与连续 ADC type2 格式不同；I²S PDM 不自动解释为 PCM，TWAI 为经典 CAN。
      </p>
    </>
  )
}
