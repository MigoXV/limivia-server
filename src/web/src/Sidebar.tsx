import { kindNames, type DeviceState } from './device'
import { navigationReason, type Section } from './navigation'
import type { ResourceView } from './peripherals'

const icons = import.meta.glob<string>('./assets/figma/v4/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})
function Icon({ name }: { name: string }) {
  return (
    <span className="nav-icon" aria-hidden="true">
      <img className="theme-light" src={icons[`./assets/figma/v4/${name}-vallum.svg`]} alt="" />
      <img className="theme-dark" src={icons[`./assets/figma/v4/${name}-abyssus.svg`]} alt="" />
    </span>
  )
}
const navigation = [
  ['home', '设备工作台', 'workspace'],
  ['peripherals', '外设调试', 'debug'],
  ['flow', '离线流程', 'flow'],
  ['network', '联网通信', 'network'],
  ['files', '板上文件', 'files'],
  ['maintenance', '设备维护', 'maintenance'],
] as const
export function Sidebar({
  state,
  section,
  view,
  theme,
  onNavigate,
  onViewChange,
  onFirmware,
  onBoard,
  onTheme,
  onConnect,
}: {
  state: DeviceState
  section: Section
  view: ResourceView | null
  theme: string
  onNavigate: (section: Section) => void
  onViewChange: (view: ResourceView) => void
  onFirmware: () => void
  onBoard: () => void
  onTheme: () => void
  onConnect: () => void
}) {
  const showResources = section === 'peripherals'
  const pinsAvailable =
    state.identity?.board === 'luatos-esp32c3-usb' &&
    state.status === 'ready' &&
    !!state.discovery?.pins.length
  const resources = state.snapshot?.resources ?? []
  return (
    <nav className="sidebar" aria-label="工作台导航">
      <div className="brand">
        <span>L·</span>
        <strong>LIMIVIA</strong>
      </div>
      <button
        className="device-context"
        onClick={onConnect}
        aria-label={state.identity ? '连接详情' : '连接设备'}
      >
        <span className="device-name">
          {state.identity?.board === 'luatos-esp32c3-usb'
            ? '合宙 ESP32-C3'
            : (state.identity?.board ?? '尚未连接设备')}
        </span>
        <span className="identity-tag">
          {state.identity ? `${state.identity.profile} · ${state.identity.firmware}` : '固件待识别'}
        </span>
        <span className="link-tag">{state.kind.toUpperCase()} · 服务主机</span>
      </button>
      <div className="sidebar-viewport" tabIndex={0} aria-label="功能与当前资源">
        <div className="sidebar-navigation">
          {navigation.map(([key, title, icon], index) => {
            const reason = navigationReason(key, state)
            return (
              <div className="nav-entry" key={key}>
                {index === 3 && <div className="nav-group-label">设备</div>}
                <button
                  className={`nav-item ${section === key ? 'selected' : ''}`}
                  aria-current={section === key ? 'page' : undefined}
                  disabled={!!reason}
                  title={reason ? `${title} · ${reason}` : undefined}
                  aria-label={title}
                  onClick={() => onNavigate(key)}
                >
                  <Icon name={icon} />
                  <span className="nav-label">{title}</span>
                  {reason && <small>{reason}</small>}
                </button>
                {key === 'peripherals' && showResources && (
                  <div className="context-resources" role="group" aria-label="当前外设资源">
                    {view?.type === 'create' && (
                      <button
                        className="context-resource selected"
                        aria-current="location"
                        onClick={() => onViewChange(view)}
                      >
                        <span>{kindNames[view.kind] ?? view.kind} · 配置草稿</span>
                        <small>尚未创建资源</small>
                      </button>
                    )}
                    {resources.map((resource) => {
                      const pins = Array.from({ length: 22 }, (_, pin) => pin).filter(
                        (pin) => resource.pin_mask & (2 ** pin),
                      )
                      const selected =
                        view?.type === 'resource' &&
                        view.id === resource.id &&
                        view.instance === resource.instance
                      return (
                        <button
                          className={`context-resource ${selected ? 'selected' : ''}`}
                          key={resource.id}
                          aria-current={selected ? 'location' : undefined}
                          onClick={() =>
                            onViewChange({
                              type: 'resource',
                              id: resource.id,
                              instance: resource.instance,
                            })
                          }
                        >
                          <span>
                            {kindNames[resource.kind] ?? resource.kind} ·{' '}
                            {pins.length ? `GPIO ${pins.join('/')}` : `#${resource.id}`}
                          </span>
                          <small>
                            {resource.state !== 'ready'
                              ? { opening: '创建中', closing: '关闭中', fault: '故障 · 仍占用' }[
                                  resource.state
                                ]
                              : state.resource_owners[resource.id]
                                ? '本页面创建'
                                : '其他来源'}
                          </small>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="sidebar-footer">
        {section !== 'home' && section !== 'flow' && (
          <button
            className="nav-item"
            aria-label="引脚与占用"
            disabled={!pinsAvailable}
            onClick={onBoard}
          >
            <Icon name="pins" />
            <span className="nav-label">引脚与占用</span>
            {!pinsAvailable && <small>不可用</small>}
          </button>
        )}
        <button className="nav-item" onClick={onFirmware}>
          <Icon name="firmware" />
          固件与能力
        </button>
        <div className="sidebar-version">
          <small>LIMIVIA</small>
          <button className="text-button" onClick={onTheme}>
            {theme === 'vallum' ? '切换苍渊' : '切换白垣'}
          </button>
        </div>
      </div>
    </nav>
  )
}
