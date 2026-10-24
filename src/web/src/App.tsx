import { useEffect, useState } from 'react'
import { LedPanel } from './LedPanel'
import { ControlAction } from './ControlAction'
import { Board } from './Board'
import { Dialog } from './WorkbenchUI'
import { Action, Result } from './Forms'
import { Sidebar } from './Sidebar'
import { navigationReason, type Section } from './navigation'
import { ResourcePanel } from './ResourcePanel'
import type { ResourceView } from './peripherals'
import { OperationsPanel, FilesPanel, NetworkPanel } from './OperationsPanel'
import { FlowPanel } from './FlowPanel'
import { useWorkbench } from './useWorkbench'
import {
  api,
  boardState,
  kindNames,
  kindDescriptions,
  phaseNames,
  type CatalogItem,
  type DeviceState,
  type LinkKind,
  type Operation,
} from './device'
const statusNames: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接与身份验证中',
  discovering: '读取固件能力',
  ready: '已连接',
  discovery_failed: '能力读取失败',
}
export default function App() {
  const workbench = useWorkbench()
  const { state, tasks, enabled, online } = workbench
  const [section, setSection] = useState<Section>('home')
  const [resourceNavigation, setResourceNavigation] = useState<{
    key: string
    view: ResourceView | null
  } | null>(null)
  const [overlay, setOverlay] = useState('')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [selected, setSelected] = useState<Operation | null>(null)
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('limivia-theme') === 'abyssus' ? 'abyssus' : 'vallum',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('limivia-theme', theme)
  }, [theme])
  const identityKey = state.identity
    ? [
        state.identity.device_id,
        state.identity.boot_id,
        state.identity.build_id,
        state.identity.profile,
        state.identity.contract,
      ].join(':')
    : ''
  useEffect(() => {
    let disposed = false
    if (identityKey)
      void api.request<CatalogItem[]>('/api/device/catalog').then((value) => {
        if (!disposed) setCatalog(value)
      })
    return () => {
      disposed = true
    }
  }, [identityKey, state.generation])
  const deviceKey = `${state.generation}:${identityKey}`
  const resourceView = resourceNavigation?.key === deviceKey ? resourceNavigation.view : null
  const changeResourceView = (view: ResourceView | null) =>
    setResourceNavigation({ key: deviceKey, view })
  const navigate = (next: Section) => {
    if (next === section) return
    changeResourceView(null)
    setSection(next)
  }
  const task = selected ? (tasks.find((t) => t.id === selected.id) ?? selected) : null
  const control =
    state.control.mine && state.control.held
      ? '已取得控制'
      : state.control.held
        ? '其他页面控制中'
        : '观察模式'
  return (
    <>
      <a className="skip-link" href="#main">
        跳到主工作区
      </a>
      <div className="workspace">
        <Sidebar
          state={state}
          section={section}
          view={resourceView}
          theme={theme}
          onNavigate={navigate}
          onViewChange={changeResourceView}
          onConnect={() => setOverlay('connect')}
          onFirmware={() => setOverlay('identity')}
          onBoard={() => setOverlay('board')}
          onTheme={() => setTheme(theme === 'vallum' ? 'abyssus' : 'vallum')}
        />
        <div className="work-area">
          <header className="topbar">
            <span className="connection-status">
              {online ? statusNames[state.status] : '后端实时通道离线'}
            </span>
            <span className="control-status">{control}</span>
            <div className="flex-space" />
            {state.identity && (
              <Action
                disabled={!online}
                run={async () => {
                  if (confirm('停止所有来源的实验并持久禁止自启？需要等待设备清理与持久化确认。'))
                    await api.request('/api/device/stop', 'POST')
                }}
              >
                停止所有实验
              </Action>
            )}
            {state.identity && (
              <button className="text-button" onClick={() => setOverlay('identity')}>
                固件详情
              </button>
            )}
          </header>
          <main
            id="main"
            className={
              section === 'home'
                ? 'home-main'
                : section === 'peripherals'
                  ? 'peripherals-main'
                  : undefined
            }
            tabIndex={-1}
          >
            {(!online ||
              state.error ||
              (state.status !== 'ready' && state.stale && state.identity)) && (
              <div className="notice" role="status">
                {!online
                  ? '实时通道已断开；正在恢复观察连接，不会重放设备命令。'
                  : state.error
                    ? typeof state.error === 'string'
                      ? state.error
                      : JSON.stringify(state.error)
                    : '设备状态待同步，旧信息仅供参考。'}
                {state.identity && (
                  <Action run={() => api.request('/api/device/refresh', 'POST')}>
                    重新读取能力与状态
                  </Action>
                )}
              </div>
            )}
            {workbench.error && <p role="alert">{workbench.error}</p>}
            {section === 'home' && (
              <>
                <div className="page-heading">
                  <h1>设备工作台</h1>
                  <Action
                    disabled={!state.identity}
                    run={() => api.request('/api/device/refresh', 'POST')}
                  >
                    重新读取能力
                  </Action>
                </div>
                {state.identity ? (
                  <>
                    <div className="summary-band">
                      <div>
                        <p>当前固件提供的能力与资源</p>
                        <small>
                          已识别固件 · {state.identity.contract} ·{' '}
                          {state.discovery ? '固件能力已读取' : '能力识别中'}
                        </small>
                      </div>
                      <div>
                        <button
                          disabled={!!navigationReason('peripherals', state)}
                          onClick={() => navigate('peripherals')}
                        >
                          打开外设目录
                        </button>
                      </div>
                    </div>
                    <LedPanel
                      key={deviceKey}
                      state={state}
                      enabled={enabled}
                      online={online}
                      onDetails={() => {
                        changeResourceView({ type: 'led' })
                        setSection('peripherals')
                      }}
                    />
                    <div className="split home-capabilities">
                      <section tabIndex={0} aria-label="当前固件提供的功能">
                        <h2>当前固件提供的功能</h2>
                        <table>
                          <thead>
                            <tr>
                              <th>功能</th>
                              <th>支持内容</th>
                              <th>状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {state.discovery?.resources
                              .filter((c) => c.available)
                              .map((c) => (
                                <tr key={c.kind}>
                                  <th scope="row">{kindNames[c.kind] ?? c.kind}</th>
                                  <td>
                                    {kindDescriptions[c.kind] ??
                                      c.actions.map((a) => a.action).join('、') ??
                                      '配置与状态'}
                                  </td>
                                  <td>
                                    {c.available ? '支持 · 容量 ' + c.capacity : '当前镜像不提供'}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        <p className="muted">
                          仅显示本次发现的能力；引脚与资源占用会在操作前再次检查。
                        </p>
                      </section>
                      <aside className="session-panel" aria-label="会话与协议">
                        <h2>会话与协议</h2>
                        <dl>
                          <dt>协议状态</dt>
                          <dd>
                            {state.status === 'ready' && !!state.discovery
                              ? '兼容 · 已验证'
                              : '状态待核实'}
                          </dd>
                        </dl>
                        <h3>设备控制</h3>
                        <p>
                          {state.control.mine && state.control.held
                            ? '当前连接持有控制权'
                            : control}
                        </p>
                        <small>释放控制不会停止已经运行的输出。</small>
                        <ControlAction state={state} />
                        <button className="text-button" onClick={() => setOverlay('identity')}>
                          查看完整固件身份
                        </button>
                      </aside>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="empty-state">
                      <h2>连接服务主机可访问的设备</h2>
                      <p>
                        从 USB / BLE 选择设备，或填写 WS / MQTT
                        目标。连接后先读取能力，保持观察模式。
                      </p>
                      <button className="primary" onClick={() => setOverlay('connect')}>
                        连接设备
                      </button>
                      <p>浏览器通过后端访问板卡；设备与串口位于服务主机。</p>
                    </div>
                    <LedPanel key={deviceKey} state={state} enabled={enabled} online={online} />
                  </>
                )}
              </>
            )}
            {section === 'peripherals' && (
              <ResourcePanel
                key={deviceKey}
                state={state}
                enabled={enabled}
                online={online}
                view={resourceView}
                onViewChange={changeResourceView}
              />
            )}
            {section === 'flow' && <FlowPanel key={deviceKey} state={state} enabled={enabled} />}
            {section === 'files' && (
              <FilesPanel key={deviceKey} state={state} enabled={enabled} catalog={catalog} />
            )}
            {section === 'network' && (
              <NetworkPanel key={deviceKey} state={state} enabled={enabled} catalog={catalog} />
            )}
            {section === 'maintenance' && (
              <>
                <OperationsPanel
                  title="设备维护"
                  state={state}
                  enabled={enabled}
                  catalog={catalog}
                  groups={[
                    'system',
                    'power',
                    'ota',
                    'diagnostics',
                    'buffer',
                    'gpio',
                    'rmt',
                    'job',
                    'mux',
                  ]}
                />
                <OTA state={state} enabled={enabled} />
              </>
            )}
            <footer className="diagnostic-bar">
              <button className="text-button" onClick={() => setOverlay('tasks')}>
                操作记录
              </button>
              <small>
                {state.identity ? `能力来源 · ${state.identity.profile}` : '尚未读取设备能力'}
              </small>
            </footer>
          </main>
        </div>
      </div>
      {overlay === 'connect' && (
        <Dialog title="连接设备" onClose={() => setOverlay('')}>
          <Connection state={state} />
        </Dialog>
      )}
      {overlay === 'identity' && (
        <Dialog title="固件身份" onClose={() => setOverlay('')}>
          <p>完整 ELF build_id 与 boot 共同用于核对设备和句柄有效期。</p>
          <div className="row">
            <button onClick={() => setOverlay('connect')}>
              {state.identity ? '连接详情' : '连接设备'}
            </button>
            <button onClick={() => setOverlay('board')}>引脚与占用</button>
          </div>
          {!state.identity && <p>连接设备并读取能力后显示固件身份。</p>}
          <dl>
            {Object.entries(state.identity ?? {}).map(([key, value]) => (
              <div className="metadata-row" key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
      {overlay === 'board' && (
        <Dialog
          title="实物接线图 · 32 引脚"
          onClose={() => setOverlay('')}
          className="board-dialog"
        >
          <Board
            state={boardState(state)}
            selected={13}
            ready={state.status === 'ready' && !state.stale}
          />
        </Dialog>
      )}
      {overlay === 'tasks' && (
        <Dialog title="操作记录" className="history-dialog" onClose={() => setOverlay('')}>
          <p>“已提交”和“设备已受理”均不是执行完成。未知结果不会自动重试。</p>
          <p>
            进行中 {tasks.filter((t) => ['submitted', 'accepted'].includes(t.status)).length} 项
          </p>
          <div className="task-list">
            {!tasks.length && <p>暂无操作记录。</p>}
            {tasks
              .filter((t) => !t.parent)
              .map((t) => (
                <div className="list-row" key={t.id}>
                  <button onClick={() => setSelected(t)}>
                    <strong>{t.op}</strong>
                    <small>
                      {new Date(t.created * 1000).toLocaleTimeString()} · {phaseNames[t.status]}
                      {t.job_id ? ' · job ' + t.job_id : ''}
                      {t.result_expired ? ' · 结果已过期' : ''}
                    </small>
                  </button>
                  {t.progress && (
                    <div>
                      <progress max={t.progress.total} value={t.progress.bytes} />
                      <small>
                        {t.progress.phase} · {t.progress.bytes}/{t.progress.total}
                      </small>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </Dialog>
      )}
      {task && (
        <Dialog title="操作详情" onClose={() => setSelected(null)}>
          <h3>
            {task.op} · {phaseNames[task.status]}
          </h3>
          <p>
            operation {task.id}
            <br />
            SDK request {task.request_id ?? '未提交'} · job {task.job_id ?? '无'} · 连接代次{' '}
            {task.generation}
          </p>
          {task.result_expired && <p>已知作业状态，但结果内容已过期。</p>}
          {(task.external_effect_possible || task.error?.may_have_executed) && (
            <p className="notice">可能已经产生外部副作用；请查询核实，不要重发原写事务。</p>
          )}
          <Result value={task.error ?? task.result ?? task.job} />
          {task.error && task.job && (
            <>
              <h3>设备作业详情</h3>
              <Result value={task.job} />
            </>
          )}
          {tasks.some((child) => child.parent === task.id) && (
            <details>
              <summary>执行步骤与分块任务</summary>
              {tasks
                .filter((child) => child.parent === task.id)
                .map((child) => (
                  <div className="list-row" key={child.id}>
                    <button onClick={() => setSelected(child)}>
                      {child.op} · {phaseNames[child.status]}
                      {child.job_id ? ' · job ' + child.job_id : ''}
                    </button>
                  </div>
                ))}
            </details>
          )}
          <div className="row">
            {task.job_id && (
              <Action
                disabled={
                  task.boot_id !== state.identity?.boot_id ||
                  task.device_id !== state.identity?.device_id
                }
                run={() => api.submit('job.get', { job_id: task.job_id! })}
              >
                查询设备作业
              </Action>
            )}
            {task.status === 'accepted' && task.job_id && (
              <Action
                disabled={!enabled}
                run={() => api.submit('job.cancel', { job_id: task.job_id! })}
              >
                请求取消
              </Action>
            )}
            {task.progress && ['submitted', 'accepted'].includes(task.status) && (
              <Action
                disabled={!enabled}
                run={() => api.request('/api/operations/' + task.id + '/abort', 'POST')}
              >
                中止上传
              </Action>
            )}
          </div>
          <small>旧 boot 的句柄不能在新启动中查询或恢复。</small>
        </Dialog>
      )}
    </>
  )
}
function Connection({ state }: { state: DeviceState }) {
  const [kind, setKind] = useState<LinkKind>('ble')
  const [target, setTarget] = useState('')
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([])
  const [searched, setSearched] = useState(false)
  const [expected, setExpected] = useState('')
  const [options, setOptions] = useState<Record<string, string>>({ protocol: '3.1.1' })
  const set = (key: string, value: string) => setOptions({ ...options, [key]: value })
  const active = state.status !== 'disconnected'
  return (
    <>
      <p>设备位于服务主机。连接后先读取能力，页面刷新不会自动申请控制。</p>
      {active ? (
        <>
          <p>
            {statusNames[state.status]} · {state.kind.toUpperCase()}
          </p>
          <ControlAction state={state} />
          <Action
            run={async () => {
              if (confirm('断开后板上资源和流程可能继续运行。确认仅断开连接？'))
                await api.request('/api/device/disconnect', 'POST')
            }}
          >
            断开设备连接
          </Action>
        </>
      ) : (
        <form onSubmit={(e) => e.preventDefault()}>
          <label className="field">
            连接方式
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as LinkKind)
                setTarget('')
                setDevices([])
                setSearched(false)
              }}
            >
              <option value="ble">BLE 蓝牙</option>
              <option value="usb">USB</option>
              <option value="ws">WebSocket</option>
              <option value="mqtt">MQTT 控制传输</option>
            </select>
          </label>
          {['usb', 'ble'].includes(kind) ? (
            <>
              <Action
                run={async () => {
                  const result = await api.request<{ devices: { id: string; name: string }[] }>(
                    `/api/device/discover?kind=${kind}`,
                  )
                  setDevices(result.devices)
                  setSearched(true)
                }}
              >
                搜索服务主机设备
              </Action>
              <label className="field">
                选择目标设备
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">请选择扫描结果</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.id}
                    </option>
                  ))}
                </select>
              </label>
              {searched && !devices.length && <p>未发现候选，请检查供电、系统权限、连接或距离。</p>}
            </>
          ) : (
            <>
              <label className="field">
                目标 URL
                <input
                  type="url"
                  value={target}
                  placeholder={kind === 'ws' ? 'ws://板卡IP/v3' : 'mqtts://broker:8883'}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              {kind === 'mqtt' && (
                <>
                  <label className="field">
                    目标 MAC *
                    <input
                      value={options.device_id ?? ''}
                      onChange={(e) => set('device_id', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    MQTT 协议
                    <select
                      value={options.protocol}
                      onChange={(e) => set('protocol', e.target.value)}
                    >
                      <option>3.1.1</option>
                      <option>5.0</option>
                    </select>
                  </label>
                  {['logical_client', 'username', 'password'].map((key) => (
                    <label className="field" key={key}>
                      {
                        {
                          logical_client: '逻辑客户端（留空每次新建）',
                          username: '用户名',
                          password: '密码',
                        }[key]
                      }
                      <input
                        type={key === 'password' ? 'password' : 'text'}
                        autoComplete="off"
                        value={options[key] ?? ''}
                        onChange={(e) => set(key, e.target.value)}
                      />
                    </label>
                  ))}
                </>
              )}
            </>
          )}
          <label className="field">
            预期设备 MAC（可选）
            <input value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
          {['ws', 'mqtt'].includes(kind) && (
            <details>
              <summary>TLS 与证书</summary>
              <p>TLS 默认验证；以下为服务主机文件路径，与板上 MQTT 的文件引用不同。</p>
              {['ca_file', 'certificate_file', 'private_key_file'].map((key) => (
                <label className="field" key={key}>
                  {
                    {
                      ca_file: '主机 CA 文件',
                      certificate_file: '主机证书文件',
                      private_key_file: '主机私钥文件',
                    }[key]
                  }
                  <input value={options[key] ?? ''} onChange={(e) => set(key, e.target.value)} />
                </label>
              ))}
            </details>
          )}
          <Action
            primary
            disabled={!target}
            run={() =>
              api.request('/api/device/connect', 'POST', {
                kind,
                target,
                ...(expected ? { expected_device_id: expected } : {}),
                options: ['ws', 'mqtt'].includes(kind)
                  ? Object.fromEntries(
                      Object.entries(options).filter(
                        ([key, value]) => value && (kind === 'mqtt' || key.endsWith('_file')),
                      ),
                    )
                  : {},
              })
            }
          >
            连接并识别固件
          </Action>
        </form>
      )}
    </>
  )
}
function OTA({ state, enabled }: { state: DeviceState; enabled: boolean }) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<unknown>(null)
  return (
    <section>
      <h2>上传 OTA 镜像</h2>
      <p>只写入非活动槽；实验活动冲突由设备拒绝，不会暗中停止实验。提交默认 reboot=false。</p>
      <input
        aria-label="OTA 镜像文件"
        type="file"
        accept=".bin"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Action
        disabled={!enabled || !file}
        run={async () => {
          if (confirm('将镜像上传到非活动槽并校验、设置下次启动槽？本次不会重启。'))
            setResult(await api.upload(file!, 'firmware.bin', false, state.identity!.profile))
        }}
      >
        上传并校验镜像
      </Action>
      <Result value={result} />
    </section>
  )
}
