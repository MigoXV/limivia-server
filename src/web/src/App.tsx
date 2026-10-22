import { useRef, useState } from 'react'
import { Board } from './Board'
import { Chart, Dialog, LedIndicator, ModeSwitch, NumberField, PinSelect } from './WorkbenchUI'
import { useWorkbench } from './useWorkbench'
import { PIN_NUMBERS, type PinMode } from './device'
import ledIcon from './assets/figma/led.svg'
import gpioIcon from './assets/figma/gpio.svg'
import pwmIcon from './assets/figma/pwm.svg'
import adcIcon from './assets/figma/adc.svg'
import timerIcon from './assets/figma/timer.svg'
import boardIcon from './assets/figma/board.svg'
import boardPreview from './assets/figma/board-preview.svg'

const sections = [
  { id: 'led', icon: ledIcon, title: '板载 LED', note: 'D5 · GPIO 13 · 无需外部接线' },
  { id: 'gpio', icon: gpioIcon, title: '数字引脚', note: '引脚能力、模式与电平分开确认' },
  { id: 'pwm', icon: pwmIcon, title: 'PWM 调制', note: '编辑参数后显式应用至设备' },
  { id: 'adc', icon: adcIcon, title: '模拟采集', note: 'ADC1 · 观察输入信号' },
  { id: 'timer', icon: timerIcon, title: '本地定时', note: '任务在芯片端执行' },
] as const
type Section = (typeof sections)[number]['id']
type Overlay = 'resources' | 'wiring' | 'logs' | 'help' | 'connection' | 'feedback' | null
interface Confirmation {
  title: string
  description: string
  label: string
  run: () => Promise<boolean>
}
const modes: Record<PinMode, string> = {
  idle: '空闲',
  input: '数字输入',
  output: '数字输出',
  pwm: 'PWM',
  adc: '模拟采集',
  timer: '本地定时',
}
const help: Record<Section | 'connection', string[]> = {
  led: [
    'D5（GPIO 13）用于本实验，无需外部接线。D4 为系统连接指示灯。',
    '开关控制与 PWM 呼吸互斥。切换前先停止当前占用，收到确认后再操作。',
    '按钮提交请求后，需要设备确认才能更新状态。失联时显示最后已知状态，恢复连接只读取，不自动重放输出命令。',
  ],
  gpio: [
    '选择引脚后设置输入或输出模式。能力、当前模式和资源占用是不同信息。',
    '输入模式读取电平；输出模式先提交目标电平，再等待设备确认。引脚被任务占用时，先查看占用任务，不静默停止。',
  ],
  pwm: [
    '频率和占空比的编辑值不代表已应用到设备。修改参数后主动应用，等待设备确认。',
    '停止前保留当前已确认参数；结果未知时先读取。PWM 并非 DAC 模拟输出。',
  ],
  adc: [
    '开始前确认引脚能力与接线范围。无采样数据不等于 0 V。仅在设备校准有效时显示电压，否则显示原始读数。',
    '停止后保留已采数据并标明停止状态。失联时标记最后读数过期，恢复后先同步状态。',
  ],
  timer: [
    '任务在芯片端执行。关闭网页或断开连接后继续，设备重启清空。',
    '失联不代表任务停止；状态无法确认时保留最后已知信息，恢复连接只读取，不重放创建命令。',
  ],
  connection: [
    '网页连接后端服务，后端电脑再通过蓝牙或 USB 访问设备。浏览器不直接请求串口或蓝牙授权。',
    '后端不可达：检查服务与地址。设备不可达：检查后端电脑上的设备连接。',
    '恢复连接后先读取真实设备状态，不自动重放改变输出的命令。',
  ],
}

export default function App() {
  const device = useWorkbench()
  const { ready, enabled, snapshot, stale, pending, hello } = device
  const [section, setSection] = useState<Section>('led')
  const [connectionPage, setConnectionPage] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [confirming, setConfirming] = useState(false)
  const confirmLock = useRef(false)
  const connectionTrigger = useRef<HTMLButtonElement>(null)
  const [ledMode, setLedMode] = useState('switch')
  const [pin, setPin] = useState(0)
  const [gpioMode, setGpioMode] = useState('input')
  const [pull, setPull] = useState('none')
  const [level, setLevel] = useState(0)
  const [frequency, setFrequency] = useState(1000)
  const [duty, setDuty] = useState(50)
  const [pwmMode, setPwmMode] = useState('fixed')
  const [breathMs, setBreathMs] = useState(2000)
  const [adcPin, setAdcPin] = useState(0)
  const [intervalMs, setIntervalMs] = useState(500)
  const [timerKind, setTimerKind] = useState('blink')
  const [highMs, setHighMs] = useState(500)
  const [lowMs, setLowMs] = useState(500)
  const [count, setCount] = useState(0)
  const active = sections.find((item) => item.id === section)!
  const selectedPin = section === 'led' ? 13 : section === 'adc' ? adcPin : pin
  const pinState = snapshot?.pins.find((item) => item.pin === selectedPin)
  const pwm = snapshot?.pwm.find((item) => item.pin === selectedPin)
  const stream = snapshot?.streams.find((item) => item.pin === adcPin)
  const samples = device.samples.filter((item) => item.pin === adcPin)
  const sample = samples.at(-1)
  const available = snapshot
    ? PIN_NUMBERS.filter((number) => snapshot.pins.some((item) => item.pin === number))
    : PIN_NUMBERS
  const mode = pinState?.mode
  const known = ready && !stale
  const ledOn = mode === 'output' && pinState?.level === 1
  const ledBreathing = !!pwm?.breath_ms
  const busyHere = pending?.scope === section
  const feedback =
    device.feedback && (device.feedback.scope === section || device.feedback.scope === 'all')
      ? device.feedback
      : null
  const conflict =
    known &&
    mode &&
    !(
      section === 'gpio' || (section === 'led' && ledMode === 'switch')
        ? ['idle', 'input', 'output']
        : section === 'pwm' || section === 'led'
          ? ['idle', 'pwm']
          : section === 'adc'
            ? ['idle', 'adc']
            : ['idle']
    ).includes(mode)
  const canApply = enabled && !conflict && available.includes(selectedPin)
  const pwmDirty =
    !!pwm &&
    (pwm.frequency !== frequency ||
      pwm.duty !== duty ||
      pwm.breath_ms !== (pwmMode === 'breath' ? breathMs : 0))
  const stateLabel =
    device.status === 'connecting'
      ? '正在连接'
      : ready
        ? stale
          ? '待同步'
          : '已连接'
        : device.status === 'lost'
          ? '连接已丢失'
          : '未连接'
  const act = (op: string, params: Record<string, unknown> = {}) => device.act(op, params, section)
  const read = () => act('state')
  const boardButton = () => (
    <button className="text-button" type="button" onClick={() => setOverlay('resources')}>
      板卡与引脚
    </button>
  )
  function closeConnection() {
    setConnectionPage(false)
    connectionTrigger.current?.focus()
  }
  function requestRelease() {
    setConfirmation({
      title: `释放 GPIO ${selectedPin}？`,
      description: `当前占用：${pinState ? modes[pinState.mode] : '未知'}。将停止该引脚上的输出或采集，并恢复为空闲；等待设备确认后再开始其他实验。`,
      label: '释放并读取状态',
      run: () => act('pin.release', { pin: selectedPin }),
    })
  }
  function changeLedMode(value: string) {
    if (value === ledMode) return
    if (known && value === 'switch' && pwm) {
      setConfirmation({
        title: '停止呼吸并切换？',
        description:
          'GPIO 13 正由 PWM 使用。停止会终止亮度变化；确认停止并同步状态后进入开关控制，不自动改变为点亮。',
        label: '停止并读取状态',
        run: async () => {
          const ok = await act('pwm.stop', { pin: 13 })
          if (ok) setLedMode(value)
          return ok
        },
      })
    } else setLedMode(value)
  }
  function requestDisconnect() {
    setConfirmation({
      title: '断开设备连接？',
      label: '断开连接',
      description:
        '断开后无法确认设备输出与本地任务状态。断开连接不等于停止输出；需要停止时，请先执行对应停止操作并等待确认。',
      run: async () => {
        const ok = await device.disconnect()
        if (ok) setOverlay(null)
        return ok
      },
    })
  }
  function requestStopAll() {
    setConfirmation({
      title: '停止全部输出？',
      label: '停止全部输出',
      description:
        '将请求停止 PWM、定时与采集，并释放实验引脚。此操作会影响其他实验，请确认后继续。',
      run: () => device.act('outputs.stop', {}, 'all'),
    })
  }
  async function confirm() {
    if (!confirmation || confirmLock.current) return
    confirmLock.current = true
    setConfirming(true)
    try {
      if (await confirmation.run()) setConfirmation(null)
    } finally {
      confirmLock.current = false
      setConfirming(false)
    }
  }
  function exportSamples() {
    const rows = [
      'uptime_ms,pin,raw,millivolts,calibrated',
      ...samples.map(
        (item) =>
          `${item.uptime_ms},${item.pin},${item.raw},${item.millivolts ?? ''},${item.calibrated}`,
      ),
    ]
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `limivia-adc-gpio${adcPin}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  function operationFeedback(fallback: string) {
    const text = busyHere
      ? '已提交请求，等待设备确认…'
      : ((feedback?.kind !== 'success' ? feedback?.text : null) ??
        (stale && snapshot
          ? '状态已过期，请先读取设备状态。'
          : !ready
            ? '连接设备后可执行；状态尚未读取。'
            : conflict
              ? `GPIO ${selectedPin} 由${modes[mode!]}占用，请先查看并释放。`
              : fallback))
    return (
      <div className="operation-feedback" aria-live="polite">
        <p
          className={feedback && feedback.kind !== 'success' ? 'feedback-error' : ''}
          role={feedback && feedback.kind !== 'success' ? 'alert' : undefined}
        >
          {text}
        </p>
        {feedback && feedback.kind !== 'success' && (
          <button type="button" className="text-button" onClick={() => setOverlay('feedback')}>
            详情
          </button>
        )}
        {conflict && (
          <button type="button" className="text-button" onClick={() => setOverlay('resources')}>
            查看占用
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <a className="skip" href="#workspace">
        跳至工作区
      </a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="LIMIVIA 首页">
          <span className="brand-mark">L·</span>
          <span>LIMIVIA</span>
        </a>
        <span className="device-name">合宙 ESP32-C3</span>
        <span className="transport-label">{device.link.toUpperCase()} · 后端电脑</span>
        <span className="connection-status" role="status">
          <i className={`status-dot ${known ? 'online' : ''}`} />
          {stateLabel}
        </span>
        <button
          ref={connectionTrigger}
          type="button"
          className="connection-entry"
          onClick={() => (ready ? setOverlay('connection') : setConnectionPage(true))}
        >
          {ready ? '连接详情' : '连接设备'}
        </button>
      </header>
      <div className="workspace-shell">
        <aside className="sidebar">
          <div className="nav-label">实验</div>
          <nav aria-label="实验功能">
            {sections.map((item) => (
              <button
                key={item.id}
                className="nav-item"
                aria-current={!connectionPage && section === item.id ? 'page' : undefined}
                onClick={() => {
                  setSection(item.id)
                  setConnectionPage(false)
                }}
              >
                <img src={item.icon} alt="" />
                <span>{item.title}</span>
              </button>
            ))}
            <button className="nav-item mobile-resources" onClick={() => setOverlay('resources')}>
              <img src={boardIcon} alt="" />
              <span>板卡与引脚</span>
            </button>
          </nav>
          <div className="sidebar-foot">
            <button className="nav-item" onClick={() => setOverlay('resources')}>
              <img src={boardIcon} alt="" />
              <span>板卡与引脚</span>
            </button>
            <small>v0.1.0</small>
          </div>
        </aside>
        <main id="workspace" tabIndex={-1}>
          <div className="page-heading">
            <div className="title-group">
              <h1 id="experiment-title">{connectionPage ? '连接与设备' : active.title}</h1>
              <p>{connectionPage ? '通过后端电脑访问 ESP32-C3' : active.note}</p>
            </div>
            {!connectionPage && section === 'led' && (
              <span className="demo-label">示意 · 非实测</span>
            )}
            <button className="text-button" onClick={() => setOverlay('help')}>
              {connectionPage ? '连接帮助' : '当前实验帮助'}
            </button>
          </div>
          <div className="main-content">
            {connectionPage ? (
              <section className="connection-panel" aria-labelledby="connection-title">
                <div className="dialog-heading">
                  <h2 id="connection-title">连接设备</h2>
                  <button className="text-button" onClick={closeConnection}>
                    关闭
                  </button>
                </div>
                <p className="muted">
                  蓝牙与 USB 均由后端电脑访问设备；浏览器无需申请串口或蓝牙权限。
                </p>
                <ModeSwitch
                  label="连接方式"
                  value={device.link}
                  onChange={device.changeLink}
                  disabled={ready || device.searching || device.status === 'connecting'}
                  options={[
                    { value: 'ble', label: 'BLE 蓝牙' },
                    { value: 'usb', label: 'USB' },
                  ]}
                />
                <div className="discovery-row">
                  <span>在后端电脑可访问的设备中查找</span>
                  <button
                    className="primary"
                    disabled={ready || device.searching || device.status === 'connecting'}
                    onClick={() => void device.search()}
                  >
                    {device.searching ? '搜索中…' : '搜索设备'}
                  </button>
                </div>
                <div className="connection-feedback" aria-live="polite">
                  {device.connectionError ? (
                    <p role="alert">{device.connectionError}</p>
                  ) : (
                    <p>
                      {device.status === 'connecting'
                        ? '正在连接设备并读取状态…'
                        : ready
                          ? '设备状态已读取，可以返回实验进行操作。'
                          : device.searching
                            ? '正在搜索后端电脑上的设备…'
                            : device.searched
                              ? device.devices.length
                                ? `发现 ${device.devices.length} 台设备，请选择后连接。`
                                : '未发现设备，请检查后端电脑的连接、设备供电后重新搜索。'
                              : '未连接 · 尚未搜索 · 选择通道后搜索设备。'}
                    </p>
                  )}
                </div>
                <div className="device-selection">
                  {device.devices.length > 0 && (
                    <>
                      <label className="sr-only" htmlFor="device-target">
                        后端设备
                      </label>
                      <select
                        id="device-target"
                        value={device.target}
                        disabled={ready || device.status === 'connecting'}
                        onChange={(event) => device.setTarget(event.target.value)}
                      >
                        <option value="">选择设备</option>
                        {device.devices.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <button
                  className="primary connect-selected"
                  disabled={
                    ready
                      ? !!pending
                      : !device.target || device.searching || device.status === 'connecting'
                  }
                  onClick={() =>
                    ready
                      ? requestDisconnect()
                      : void device.connect().then((ok) => {
                          if (ok) closeConnection()
                        })
                  }
                >
                  {ready
                    ? '断开连接…'
                    : device.status === 'connecting'
                      ? '连接中…'
                      : '连接所选设备'}
                </button>
                <p className="small muted">恢复连接只读取设备状态，不自动重放输出命令。</p>
              </section>
            ) : (
              <>
                {(device.status === 'lost' || (stale && snapshot && section !== 'led')) && (
                  <div className="recovery-bar" role="status">
                    <span>
                      {device.status === 'lost'
                        ? '连接已丢失，板上任务可能仍在运行。'
                        : '上次状态已过期，执行结果尚未确认。'}
                    </span>
                    <button
                      disabled={!!pending}
                      onClick={() => (ready ? void read() : setConnectionPage(true))}
                    >
                      {ready ? '读取状态' : '重新连接'}
                    </button>
                  </div>
                )}
                {section === 'led' && (
                  <section className="led-workspace" aria-label="LED 控制与状态">
                    <div className="led-primary">
                      <div className="led-controls">
                        <span className="field-caption">控制模式</span>
                        <ModeSwitch
                          label="LED 控制模式"
                          value={ledMode}
                          onChange={changeLedMode}
                          disabled={!!pending}
                          options={[
                            { value: 'switch', label: '开关控制' },
                            { value: 'breath', label: '呼吸演示' },
                          ]}
                        />
                        <div className="button-row">
                          <button
                            className="primary"
                            disabled={!canApply}
                            onClick={() =>
                              ledMode === 'switch'
                                ? void act('gpio.set', {
                                    pin: 13,
                                    mode: 'output',
                                    pull: 'none',
                                    level: ledOn ? 0 : 1,
                                  })
                                : ledBreathing
                                  ? setConfirmation({
                                      title: '停止呼吸？',
                                      description:
                                        '停止 GPIO 13 的 PWM 呼吸并释放引脚；以设备返回的状态确认结果。',
                                      label: '停止并读取状态',
                                      run: () => act('pwm.stop', { pin: 13 }),
                                    })
                                  : void act('pwm.set', {
                                      pin: 13,
                                      frequency: 1000,
                                      duty: 80,
                                      breath_ms: 2000,
                                    })
                            }
                          >
                            {busyHere && pending?.op !== 'state'
                              ? '等待确认…'
                              : ledMode === 'switch'
                                ? ledOn
                                  ? '熄灭 LED'
                                  : '点亮 LED'
                                : ledBreathing
                                  ? '停止呼吸'
                                  : '开始呼吸'}
                          </button>
                          <button disabled={!ready || !!pending} onClick={() => void read()}>
                            {busyHere && pending?.op === 'state' ? '读取中…' : '读取状态'}
                          </button>
                        </div>
                        {operationFeedback(
                          ledBreathing
                            ? 'GPIO 13 由 PWM 呼吸占用。停止并确认后可切换控制模式。'
                            : '设备状态已同步。',
                        )}
                      </div>
                      <div className="led-confirmation">
                        <LedIndicator
                          state={
                            busyHere
                              ? 'pending'
                              : !known
                                ? 'unknown'
                                : ledBreathing
                                  ? 'breath'
                                  : ledOn
                                    ? 'on'
                                    : mode === 'idle' || mode === 'output'
                                      ? 'off'
                                      : 'unknown'
                          }
                        />
                        <div className="device-confirmation">
                          <span className="field-caption">设备状态</span>
                          <h2>
                            {busyHere
                              ? '等待确认'
                              : !known
                                ? snapshot
                                  ? '结果未知'
                                  : '尚未读取'
                                : ledBreathing
                                  ? '呼吸运行中'
                                  : pwm
                                    ? 'PWM 输出中'
                                    : mode === 'timer'
                                      ? '本地任务占用'
                                      : mode === 'input' || mode === 'adc'
                                        ? `${modes[mode]}占用`
                                        : ledOn
                                          ? '已点亮'
                                          : '已熄灭'}
                          </h2>
                          <p>
                            {busyHere
                              ? '提交不代表执行成功'
                              : !known
                                ? snapshot
                                  ? '上次状态 · 已过期'
                                  : '尚未读取设备'
                                : '已收到设备确认'}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="led-secondary">
                      <div>
                        <h3>{ledMode === 'switch' ? '开关控制' : '呼吸演示'}</h3>
                        <p>
                          {ledMode === 'switch'
                            ? '单次设置点亮或熄灭。等待设备确认后再判断输出；读取状态不会改变输出。'
                            : '按周期调整亮度。开始后由 PWM 占用 LED 引脚；切回开关控制前需确认停止。'}
                        </p>
                      </div>
                      <div>
                        <h3>引脚与资源</h3>
                        <p>
                          {!known
                            ? '占用状态待同步；连接恢复后先读取设备。'
                            : conflict
                              ? `当前由${modes[mode!]}占用；释放后可开始实验。`
                              : ledBreathing
                                ? 'PWM 呼吸占用中；停止后可返回开关控制。'
                                : '切换为呼吸演示后，PWM 将使用当前 LED 引脚。'}
                        </p>
                        {boardButton()}
                      </div>
                    </div>
                  </section>
                )}
                {section === 'gpio' && (
                  <>
                    <form
                      className="gpio-workspace"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void act('gpio.set', {
                          pin,
                          mode: gpioMode,
                          pull: gpioMode === 'input' ? pull : 'none',
                          level,
                        })
                      }}
                    >
                      <fieldset disabled={!!pending}>
                        <div className="gpio-options">
                          <PinSelect value={pin} onChange={setPin} available={available} />
                          <div className="mode-field">
                            <span className="field-caption">工作模式</span>
                            <ModeSwitch
                              label="工作模式"
                              value={gpioMode}
                              onChange={setGpioMode}
                              options={[
                                { value: 'input', label: '输入' },
                                { value: 'output', label: '输出' },
                              ]}
                            />
                          </div>
                          <div className="pin-capability">
                            <p>能力：数字输入 / 输出</p>
                            <p className="muted">
                              占用：{known && pinState ? modes[pinState.mode] : '尚未同步'}
                            </p>
                          </div>
                        </div>
                        <div className="gpio-main">
                          <div className="gpio-controls">
                            {gpioMode === 'input' ? (
                              <label>
                                内部电阻
                                <select
                                  value={pull}
                                  onChange={(event) => setPull(event.target.value)}
                                >
                                  <option value="none">无上下拉</option>
                                  <option value="up">上拉</option>
                                  <option value="down">下拉</option>
                                </select>
                              </label>
                            ) : (
                              <label>
                                目标电平
                                <select
                                  value={level}
                                  onChange={(event) => setLevel(Number(event.target.value))}
                                >
                                  <option value="0">低电平 · 0</option>
                                  <option value="1">高电平 · 1</option>
                                </select>
                              </label>
                            )}
                            <button type="submit" className="primary" disabled={!canApply}>
                              {busyHere && pending?.op !== 'state'
                                ? '等待确认…'
                                : gpioMode === 'input'
                                  ? '应用输入配置'
                                  : '应用输出配置'}
                            </button>
                            {operationFeedback(
                              gpioMode === 'input'
                                ? '配置确认后显示输入电平。读数来自设备状态快照。'
                                : '目标电平在提交并收到设备确认后生效。',
                            )}
                          </div>
                          <div className="gpio-reading">
                            <h2>
                              {!known || mode !== gpioMode
                                ? '设备当前读数'
                                : mode === 'input'
                                  ? '输入读数'
                                  : '设备已确认输出'}
                            </h2>
                            <strong className="reading-value">
                              {pinState?.level == null
                                ? '尚未读取'
                                : pinState.level === 1
                                  ? '高电平'
                                  : '低电平'}
                            </strong>
                            <p className="muted">
                              {!known && snapshot
                                ? '上次读数 · 已失效'
                                : known
                                  ? `设备模式：${pinState ? modes[pinState.mode] : '尚未读取'}`
                                  : '尚未读取设备'}
                            </p>
                            {known && mode !== gpioMode && (
                              <p className="muted">工作模式尚未应用。</p>
                            )}
                            <button
                              type="button"
                              disabled={!ready || !!pending}
                              onClick={() => void read()}
                            >
                              刷新状态
                            </button>
                          </div>
                        </div>
                      </fieldset>
                    </form>
                    <div className="workspace-note">
                      <p>3.3 V 逻辑 · 与外设共地。仅列出允许实验且支持所选模式的引脚。</p>
                      {boardButton()}
                    </div>
                  </>
                )}
                {section === 'pwm' && (
                  <>
                    <div className="pwm-workspace">
                      <form
                        className="pwm-controls"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void act('pwm.set', {
                            pin,
                            frequency,
                            duty,
                            breath_ms: pwmMode === 'breath' ? breathMs : 0,
                          })
                        }}
                      >
                        <fieldset disabled={!!pending}>
                          <div className="form-row">
                            <PinSelect value={pin} onChange={setPin} available={available} />
                            <NumberField
                              label="输出频率"
                              value={frequency}
                              onChange={setFrequency}
                              min={5}
                              max={40000}
                              unit="Hz"
                            />
                            <NumberField
                              label="占空比"
                              value={duty}
                              onChange={setDuty}
                              min={0}
                              max={100}
                              step={0.1}
                              unit="%"
                            />
                          </div>
                          <div className="pwm-mode-row">
                            <ModeSwitch
                              label="PWM 模式"
                              value={pwmMode}
                              onChange={setPwmMode}
                              options={[
                                { value: 'fixed', label: '固定占空比' },
                                { value: 'breath', label: '周期呼吸' },
                              ]}
                            />
                            <span className="small muted">
                              LEDC · 最多 {hello?.capabilities.max_pwm ?? 4} 路
                            </span>
                          </div>
                          {pwmMode === 'breath' && (
                            <NumberField
                              label="呼吸周期"
                              value={breathMs}
                              onChange={setBreathMs}
                              min={200}
                              max={60000}
                              unit="ms"
                            />
                          )}
                          <div className="button-row">
                            <button className="primary" type="submit" disabled={!canApply}>
                              {busyHere && pending?.op === 'pwm.set'
                                ? '等待确认…'
                                : pwm
                                  ? '应用修改'
                                  : '启动 PWM'}
                            </button>
                            <button
                              type="button"
                              disabled={!enabled || !pwm}
                              onClick={() => void act('pwm.stop', { pin })}
                            >
                              {pending?.op === 'pwm.stop' ? '停止中…' : '停止 PWM'}
                            </button>
                          </div>
                        </fieldset>
                        {operationFeedback(
                          pwmDirty
                            ? '有未应用修改'
                            : pwm
                              ? '参数与设备已确认配置一致。'
                              : '该引脚尚未启用 PWM。',
                        )}
                        <p className="muted">频率范围 5–40000 Hz。占空比使用精确百分比输入。</p>
                      </form>
                      <section className="pwm-confirmed" aria-labelledby="pwm-confirmed-title">
                        <h2 id="pwm-confirmed-title">设备实际配置</h2>
                        <table>
                          <thead>
                            <tr>
                              <th>参数</th>
                              <th>正在编辑</th>
                              <th>设备已确认</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <th>频率</th>
                              <td>{Number.isNaN(frequency) ? '—' : frequency} Hz</td>
                              <td>{pwm ? `${pwm.frequency} Hz` : '—'}</td>
                            </tr>
                            <tr>
                              <th>占空比</th>
                              <td>{Number.isNaN(duty) ? '—' : duty} %</td>
                              <td>{pwm ? `${pwm.duty} %` : '—'}</td>
                            </tr>
                            <tr>
                              <th>运行状态</th>
                              <td>草稿不代表设备输出</td>
                              <td>
                                {!known
                                  ? snapshot
                                    ? '最后已知 · 已过期'
                                    : '尚未读取'
                                  : pwm
                                    ? pwm.breath_ms
                                      ? '呼吸运行中'
                                      : '运行中'
                                    : '未运行'}
                              </td>
                            </tr>
                            {(pwmMode === 'breath' || !!pwm?.breath_ms) && (
                              <tr>
                                <th>呼吸周期</th>
                                <td>{pwmMode === 'breath' ? `${breathMs} ms` : '关闭'}</td>
                                <td>{pwm?.breath_ms ? `${pwm.breath_ms} ms` : '—'}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        {stale && ready && (
                          <button disabled={!!pending} onClick={() => void read()}>
                            重新读取
                          </button>
                        )}
                      </section>
                    </div>
                    <div className="workspace-note">
                      <div>
                        <p>仅在应用时提交参数；编辑不会持续发送硬件命令。</p>
                        <p>占用冲突时先查看占用者，再显式停止或释放；不会静默覆盖其他实验。</p>
                      </div>
                      {boardButton()}
                    </div>
                  </>
                )}
                {section === 'adc' && (
                  <section className="adc-workspace" aria-label="ADC 采集">
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void act(
                          stream ? 'adc.stop' : 'adc.start',
                          stream ? { pin: adcPin } : { pin: adcPin, interval_ms: intervalMs },
                        )
                      }}
                    >
                      <fieldset disabled={!!pending}>
                        <div className="form-row adc-actions">
                          <PinSelect
                            value={adcPin}
                            onChange={setAdcPin}
                            adc
                            available={available}
                          />
                          <NumberField
                            label="采样间隔"
                            value={intervalMs}
                            onChange={setIntervalMs}
                            min={100}
                            max={10000}
                            unit="ms"
                          />
                          <button
                            className="primary"
                            type={stream ? 'button' : 'submit'}
                            onClick={
                              stream ? () => void act('adc.stop', { pin: adcPin }) : undefined
                            }
                            disabled={!canApply}
                          >
                            {busyHere && pending?.op !== 'state'
                              ? '等待确认…'
                              : stream
                                ? '停止采样'
                                : '开始采样'}
                          </button>
                          {boardButton()}
                        </div>
                      </fieldset>
                    </form>
                    <p>接线范围 0–2.5 V · 禁止直接接入 5 V。请核对板上丝印并与外设共地。</p>
                    <div className="adc-readings">
                      <div>
                        <span>电压 / mV</span>
                        <strong>{sample?.millivolts ?? '—'}</strong>
                      </div>
                      <div>
                        <span>原始读数 / 4095</span>
                        <strong>{sample?.raw ?? '—'}</strong>
                      </div>
                      <div className="sampling-status">
                        <h2>
                          {!known
                            ? samples.length
                              ? '上次读数 · 已失效'
                              : '尚未采样'
                            : stream
                              ? '采样中'
                              : samples.length
                                ? '已停止'
                                : '尚未采样'}
                        </h2>
                        <p>
                          {sample
                            ? `设备时间 ${(sample.uptime_ms / 1000).toFixed(1)} s${sample.calibrated ? '' : ' · 无可用校准'}`
                            : '等待第一帧数据'}
                          {stream ? ` · ${stream.interval_ms} ms / 次` : ''}
                        </p>
                      </div>
                    </div>
                    <Chart samples={samples.slice(-60)} stale={stale || !ready} />
                    <div className="chart-footer">
                      <span>曲线按接收样本更新；采样间隔不等于端到端延迟。</span>
                      <button
                        className="text-button"
                        disabled={!samples.length}
                        onClick={exportSamples}
                      >
                        导出 CSV
                      </button>
                    </div>
                    <details className="sampling-options">
                      <summary>单次采样与间隔设置</summary>
                      <div className="button-row">
                        <button
                          disabled={!canApply}
                          onClick={() => void act('adc.read', { pin: adcPin })}
                        >
                          读取一次
                        </button>
                        <button
                          disabled={
                            !canApply ||
                            !stream ||
                            !Number.isInteger(intervalMs) ||
                            intervalMs < 100 ||
                            intervalMs > 10000
                          }
                          onClick={() =>
                            void act('adc.start', { pin: adcPin, interval_ms: intervalMs })
                          }
                        >
                          更新采样间隔
                        </button>
                        <button
                          disabled={!enabled || mode !== 'adc'}
                          onClick={() => void act('adc.stop', { pin: adcPin })}
                        >
                          停止并释放
                        </button>
                      </div>
                    </details>
                    {operationFeedback(
                      stream ? '采样运行状态已由设备确认。' : '开始采样后显示真实设备数据。',
                    )}
                  </section>
                )}
                {section === 'timer' && (
                  <section className="timer-workspace" aria-label="本地任务">
                    <h2>待创建任务 · GPIO {pin}</h2>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void act('timer.start', {
                          pin,
                          kind: timerKind,
                          high_ms: highMs,
                          low_ms: lowMs,
                          count,
                        })
                      }}
                    >
                      <fieldset disabled={!!pending}>
                        <div className="form-row timer-fields">
                          <PinSelect value={pin} onChange={setPin} available={available} />
                          <label>
                            动作
                            <select
                              value={timerKind}
                              onChange={(event) => setTimerKind(event.target.value)}
                            >
                              <option value="blink">周期闪烁</option>
                              <option value="pulse">单次高电平脉冲</option>
                            </select>
                          </label>
                          <NumberField
                            label="高电平时间"
                            value={highMs}
                            onChange={setHighMs}
                            min={10}
                            max={3600000}
                            unit="ms"
                          />
                          {timerKind === 'blink' && (
                            <>
                              <NumberField
                                label="低电平时间"
                                value={lowMs}
                                onChange={setLowMs}
                                min={10}
                                max={3600000}
                                unit="ms"
                              />
                              <NumberField
                                label="重复次数（0 为持续）"
                                value={count}
                                onChange={setCount}
                                min={0}
                                max={100000}
                                unit="次"
                              />
                            </>
                          )}
                        </div>
                        <div className="task-create">
                          <button
                            className="primary"
                            type="submit"
                            disabled={
                              !canApply ||
                              (snapshot?.timers.length ?? 0) >=
                                (hello?.capabilities.max_timers ?? 4)
                            }
                          >
                            {pending?.op === 'timer.start' ? '等待确认…' : '启动本地任务'}
                          </button>
                          <p>
                            待创建：GPIO {pin} · 高 {Number.isNaN(highMs) ? '—' : highMs} ms
                            {timerKind === 'blink'
                              ? ` / 低 ${Number.isNaN(lowMs) ? '—' : lowMs} ms · ${count === 0 ? '持续循环' : `${count} 次`}`
                              : ' · 单次脉冲'}
                            。确认创建后加入下方列表。
                          </p>
                        </div>
                      </fieldset>
                    </form>
                    <div className="task-heading">
                      <h2>设备上已存在的任务</h2>
                      <span>
                        {snapshot?.timers.length ?? '—'} / {hello?.capabilities.max_timers ?? 4}
                      </span>
                      <button
                        className="text-button"
                        disabled={!ready || !!pending}
                        onClick={() => void read()}
                      >
                        刷新任务
                      </button>
                    </div>
                    <div className="task-table">
                      <div className="task-header" aria-hidden="true">
                        <span>任务 / 引脚</span>
                        <span>动作与时间</span>
                        <span>状态</span>
                        <span />
                      </div>
                      <div className="task-list">
                        {snapshot?.timers.length ? (
                          snapshot.timers.map((task) => (
                            <div className="task-row" key={task.id}>
                              <span className="mono">
                                #{task.id} / GPIO {task.pin}
                              </span>
                              <span>
                                {task.kind === 'blink' ? '周期闪烁' : '单次脉冲'} · 高{' '}
                                {task.high_ms} ms
                                {task.kind === 'blink' ? ` / 低 ${task.low_ms} ms` : ''}
                                <br />
                                {task.kind === 'pulse'
                                  ? '执行一次'
                                  : task.count
                                    ? `${task.count} 次`
                                    : '持续循环'}
                              </span>
                              <span>{known ? '运行中' : '最后已知 · 状态未知'}</span>
                              <button
                                disabled={!enabled}
                                onClick={() =>
                                  setConfirmation({
                                    title: `停止本地任务 #${task.id}？`,
                                    label: '停止任务',
                                    description: `目标：GPIO ${task.pin} · ${task.kind === 'blink' ? '周期闪烁' : '单次脉冲'}。停止后不再执行该任务；输出电平与资源释放行为以固件确认结果为准。`,
                                    run: () => act('timer.stop', { pin: task.pin }),
                                  })
                                }
                              >
                                停止任务
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="empty-text">
                            {known ? '设备上暂无本地任务。' : '尚未读取任务；连接设备后查看。'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="task-lifecycle">
                      <h3>运行位置与生命周期</h3>
                      <p>
                        芯片端执行；关闭网页、断开连接后继续；重启清空。
                        <br />
                        失联时状态未知；重连只读取，不自动重放输出命令。
                      </p>
                    </div>
                    {operationFeedback('任务状态来自设备快照。')}
                  </section>
                )}
              </>
            )}
          </div>
          <footer className="diagnostic-bar">
            <button className="text-button" onClick={() => setOverlay('logs')}>
              <span aria-hidden="true">›</span> 命令与事件
              {device.logs.length > 0 ? ` · ${device.logs.length}` : ''}
            </button>
            <span>
              {!ready
                ? '参数可预设 · 执行需连接设备'
                : stale
                  ? '状态已过期 · 请先读取设备'
                  : '设备确认状态 · 非物理测量'}
            </span>
          </footer>
        </main>
      </div>
      {overlay === 'help' && (
        <Dialog
          title={connectionPage ? '连接帮助' : `当前实验帮助 · ${active.title}`}
          onClose={() => setOverlay(null)}
          className="help-dialog"
        >
          {help[connectionPage ? 'connection' : section].map((text) => (
            <p key={text}>{text}</p>
          ))}
        </Dialog>
      )}
      {overlay === 'connection' && (
        <Dialog title="当前连接" onClose={() => setOverlay(null)} className="connection-dialog">
          <p className="muted">蓝牙与 USB 均由后端电脑访问设备；浏览器无需申请串口或蓝牙权限。</p>
          <h3>
            {stateLabel} · {device.link.toUpperCase()}
          </h3>
          <p>
            合宙 ESP32-C3 · 后端电脑提供访问
            <br />
            {hello?.device_id} · 固件 {hello?.firmware}
            <br />
            {known ? '设备状态已读取' : '等待设备状态同步'}
          </p>
          <div className="button-row">
            <button disabled={!ready || !!pending} onClick={requestDisconnect}>
              断开连接…
            </button>
            <button
              className="text-button"
              onClick={() => {
                setOverlay(null)
                setConnectionPage(true)
              }}
            >
              管理连接
            </button>
          </div>
          <p className="small muted">断开连接不会停止设备本地任务。</p>
        </Dialog>
      )}
      {(overlay === 'resources' || overlay === 'wiring') && (
        <Dialog title="引脚与资源" onClose={() => setOverlay(null)} className="resources-dialog">
          <p className="muted">按任务查看占用。受保护引脚不提供实验操作。</p>
          <div className="resources-main">
            <div className="board-preview">
              <img src={boardPreview} alt="CORE ESP32-C3 功能示意，非实物接线图" />
              <span className="preview-chip">
                ESP32
                <br />
                C3
              </span>
              <span className="preview-core">CORE · USB</span>
            </div>
            <div className="resource-details">
              <h3>
                GPIO {selectedPin}
                {selectedPin === 13 ? ' · D5' : ''}
              </h3>
              <p>
                {selectedPin === 13
                  ? '可用于 LED 开关与 PWM 呼吸。'
                  : '可用于数字输入、输出、PWM 或本地任务。'}
                <br />
                当前占用：{pinState ? modes[pinState.mode] : '尚未读取'}
                {!known && snapshot ? '（最后已知 · 已过期）' : ''}
              </p>
              <div className="protection">
                <h3>保护与能力</h3>
                <p>
                  USB 18/19、Flash 与启动配置引脚不开放实验操作。D4 由系统管理。
                  <br />
                  其他引脚的模式能力由设备能力表筛选，不默认全支持。
                </p>
              </div>
              <div className="button-row">
                <button
                  disabled={!enabled || !pinState || mode === 'idle'}
                  onClick={requestRelease}
                >
                  释放引脚
                </button>
                <button className="text-button" onClick={() => setOverlay('wiring')}>
                  实物接线图 · 32 引脚
                </button>
              </div>
            </div>
          </div>
          <button className="stop-all" disabled={!enabled} onClick={requestStopAll}>
            停止全部输出…
          </button>
          <p className="small muted">板图为功能示意；接线请打开 32 引脚实物图并核对板上丝印。</p>
        </Dialog>
      )}
      {overlay === 'wiring' && (
        <Dialog
          title="实物接线图 · 32 引脚"
          onClose={() => setOverlay('resources')}
          className="wiring-dialog"
        >
          <Board state={snapshot} selected={selectedPin} ready={known} />
        </Dialog>
      )}
      {overlay === 'logs' && (
        <Dialog title="命令与事件" onClose={() => setOverlay(null)} className="logs-dialog">
          <div className="log-toolbar">
            <p className="muted">辅助诊断 · 失败同时在相关操作附近显示。</p>
            <button
              className="text-button"
              disabled={!device.logs.length}
              onClick={device.clearLogs}
            >
              清空日志
            </button>
          </div>
          <div className="console-body">
            {device.logs.length ? (
              device.logs.map((item) => (
                <div className="log-row" key={item.id}>
                  <time>{item.time}</time>
                  <span>{item.direction}</span>
                  <code>{item.text}</code>
                </div>
              ))
            ) : (
              <p className="empty-text">暂无命令与事件。连接设备后记录真实操作。</p>
            )}
          </div>
          <p className="small muted">仅保留当前页面最近 200 条事件。</p>
        </Dialog>
      )}
      {overlay === 'feedback' && (
        <Dialog title="状态反馈详情" onClose={() => setOverlay(null)}>
          <p>{device.feedback?.text}</p>
          <p className="muted">
            {device.feedback?.kind === 'unknown'
              ? '执行结果尚未确认；先读取设备状态，不要直接重复提交输出命令。'
              : '设备拒绝本次操作。检查参数与引脚占用后重试。'}
          </p>
          <button
            disabled={!ready || !!pending}
            onClick={() =>
              void read().then((ok) => {
                if (ok) setOverlay(null)
              })
            }
          >
            读取状态
          </button>
        </Dialog>
      )}
      {confirmation && (
        <Dialog
          title={confirmation.title}
          onClose={() => {
            if (!confirming) setConfirmation(null)
          }}
          className="confirmation-dialog"
        >
          <p className="muted">{confirmation.description}</p>
          <div className="button-row">
            <button
              className="primary"
              disabled={confirming || (!enabled && confirmation.label !== '断开连接')}
              onClick={() => void confirm()}
            >
              {confirming ? '等待确认…' : confirmation.label}
            </button>
            <button disabled={confirming} onClick={() => setConfirmation(null)}>
              取消
            </button>
          </div>
          {device.feedback && device.feedback.kind !== 'success' ? (
            <p role="alert">{device.feedback.text}</p>
          ) : (
            <p className="muted">等待设备确认后更新状态；未确认时结果仍未知。</p>
          )}
          {stale && ready && (
            <button
              disabled={confirming || !!pending}
              onClick={() => void device.act('state', {}, 'all')}
            >
              读取状态
            </button>
          )}
        </Dialog>
      )}
    </div>
  )
}
