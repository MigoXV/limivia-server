import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DeviceClient,
  PIN_NUMBERS,
  friendlyError,
  type Hello,
  type LinkKind,
  type PinMode,
  type Sample,
  type Snapshot,
} from './device'

const modes: Record<PinMode, string> = {
  idle: '空闲',
  input: '数字输入',
  output: '数字输出',
  pwm: 'PWM',
  adc: '模拟采集',
  timer: '本地定时',
}
const sections = [
  { id: 'led', icon: '◉', title: '板载 LED', note: '从一束光开始', number: '01' },
  { id: 'gpio', icon: '⌘', title: '数字引脚', note: '读取与输出电平', number: '02' },
  { id: 'pwm', icon: '∿', title: 'PWM 调制', note: '控制频率与亮度', number: '03' },
  { id: 'adc', icon: '⌁', title: '模拟采集', note: '观察电压的变化', number: '04' },
  { id: 'timer', icon: '◷', title: '本地定时', note: '让设备独立运行', number: '05' },
] as const
type Section = (typeof sections)[number]['id']
type Status = 'disconnected' | 'connecting' | 'ready' | 'lost'
interface Log {
  id: number
  time: string
  direction: string
  text: string
}

function PinSelect({
  value,
  onChange,
  adc = false,
}: {
  value: number
  onChange: (n: number) => void
  adc?: boolean
}) {
  return (
    <label>
      目标引脚
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {(adc ? [0, 1, 3, 4] : PIN_NUMBERS).map((pin) => (
          <option key={pin} value={pin}>
            GPIO {pin}
            {pin === 13 ? ' · D5 LED' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  step?: number
  unit?: string
}) {
  return (
    <label>
      {label}
      <span className="number-field">
        <input
          type="number"
          required
          min={min}
          max={max}
          step={step}
          value={Number.isNaN(value) ? '' : value}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
        <span>{unit}</span>
      </span>
    </label>
  )
}
function Board({
  state,
  selected,
  ready,
}: {
  state: Snapshot | null
  selected: number
  ready: boolean
}) {
  const left = [0, 1, 12, 18, 19, 20, 21, 13]
  const right = [3, 2, 4, 5, 6, 7, 8, 9]
  return (
    <div className="board-wrap">
      <svg
        className="board"
        viewBox="0 0 280 350"
        role="img"
        aria-label={`合宙 ESP32-C3 功能示意，选中 GPIO ${selected}；非接线比例图`}
      >
        <rect className="pcb" x="65" y="20" width="150" height="300" rx="8" />
        <path className="antenna" d="M85 60V40h15v20h15V40h15v20h15V40h15v20h15V40h20v25" />
        <rect className="chip" x="102" y="105" width="76" height="76" rx="3" />
        <text className="chip-label" x="140" y="137" textAnchor="middle">
          ESP32
        </text>
        <text className="chip-label" x="140" y="158" textAnchor="middle">
          C3
        </text>
        <text className="board-small" x="140" y="207" textAnchor="middle">
          CORE · USB
        </text>
        <circle
          className={ready && (state?.ble_connected || state?.usb_active) ? 'led active' : 'led'}
          cx="118"
          cy="238"
          r="5"
        />
        <circle
          className={
            ready && state?.pins.find((p) => p.pin === 13)?.level === 1 ? 'led active' : 'led'
          }
          cx="162"
          cy="238"
          r="5"
        />
        <text className="board-small" x="118" y="258" textAnchor="middle">
          D4
        </text>
        <text className="board-small" x="162" y="258" textAnchor="middle">
          D5
        </text>
        <rect className="usb" x="120" y="287" width="40" height="43" rx="5" />
        <rect className="usb-slot" x="127" y="310" width="26" height="10" rx="3" />
        {[left, right].map((list, side) =>
          list.map((pin, i) => (
            <g key={`${side}-${pin}`} className={selected === pin ? 'pin selected-pin' : 'pin'}>
              <rect x={side ? 208 : 58} y={80 + i * 25} width="14" height="9" rx="1" />
              <text x={side ? 235 : 45} y={88 + i * 25} textAnchor={side ? 'start' : 'end'}>
                {String(pin).padStart(2, '0')}
              </text>
            </g>
          )),
        )}
      </svg>
      <p className="caption">功能位置示意 · 接线请核对板上丝印</p>
    </div>
  )
}
function Chart({ samples }: { samples: Sample[] }) {
  const points = samples
    .map(
      (s, i) => `${20 + (i / Math.max(samples.length - 1, 1)) * 600},${150 - (s.raw / 4095) * 130}`,
    )
    .join(' ')
  return (
    <div className="chart">
      <svg
        viewBox="0 0 640 180"
        role="img"
        aria-label={
          samples.length ? `最近 ${samples.length} 个 ADC 原始采样值` : '尚无 ADC 采样数据'
        }
      >
        {[20, 85, 150].map((y) => (
          <line key={y} x1="20" x2="620" y1={y} y2={y} className="grid-line" />
        ))}
        {samples.length > 1 && <polyline points={points} fill="none" className="signal-line" />}
        {samples.length === 1 && (
          <circle cx="20" cy={150 - (samples[0].raw / 4095) * 130} r="3" className="signal-dot" />
        )}
        <text x="20" y="173">
          较早
        </text>
        <text x="620" y="173" textAnchor="end">
          现在
        </text>
      </svg>
      {!samples.length && <span className="chart-empty">开始采集后，信号将在这里呈现</span>}
    </div>
  )
}

export default function App() {
  const [client] = useState(() => new DeviceClient())
  const [section, setSection] = useState<Section>('led')
  const [link, setLink] = useState<LinkKind>('usb')
  const [status, setStatus] = useState<Status>('disconnected')
  const [hello, setHello] = useState<Hello | null>(null)
  const [state, setState] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [stale, setStale] = useState(false)
  const [logs, setLogs] = useState<Log[]>([])
  const logId = useRef(0)
  const [pin, setPin] = useState(0)
  const [gpioMode, setGpioMode] = useState('input')
  const [pull, setPull] = useState('none')
  const [level, setLevel] = useState(0)
  const [frequency, setFrequency] = useState(1000)
  const [duty, setDuty] = useState(50)
  const [breath, setBreath] = useState(false)
  const [breathMs, setBreathMs] = useState(2000)
  const [adcPin, setAdcPin] = useState(0)
  const [intervalMs, setIntervalMs] = useState(500)
  const [samples, setSamples] = useState<Sample[]>([])
  const [timerKind, setTimerKind] = useState('blink')
  const [highMs, setHighMs] = useState(500)
  const [lowMs, setLowMs] = useState(500)
  const [count, setCount] = useState(0)
  const ready = status === 'ready'
  const enabled = ready && !busy && !stale
  const activeSection = sections.find((s) => s.id === section)!
  const selectedPin = section === 'led' ? 13 : section === 'adc' ? adcPin : pin
  const pinState = state?.pins.find((p) => p.pin === selectedPin)
  const sample = samples.filter((s) => s.pin === adcPin).at(-1)
  const activePwm = state?.pwm.find((p) => p.pin === selectedPin)
  const activeStream = state?.streams.find((p) => p.pin === adcPin)
  const supported =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    (link === 'usb' ? 'serial' in navigator : 'bluetooth' in navigator)
  const log = useCallback((direction: string, text: string) => {
    const item = {
      id: ++logId.current,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      direction,
      text,
    }
    setLogs((previous) => [...previous.slice(-199), item])
  }, [])
  const addSample = useCallback(
    (value: Sample) => setSamples((previous) => [...previous.slice(-119), value]),
    [],
  )
  useEffect(() => {
    client.setHandlers({
      onLog: log,
      onClose: () => {
        setStatus('lost')
        setStale(true)
        setError('设备连接已断开。板上定时与 PWM 可能仍在运行，请重新连接查看。')
        log('连接', '设备已断开')
      },
      onEvent: (message) => {
        if (message.event === 'adc' && message.data) addSample(message.data)
      },
    })
    return () => {
      client.setHandlers({})
      void client.disconnect()
    }
  }, [client, log, addSample])
  useEffect(() => {
    if (!ready) return
    let disposed = false
    const timer = setInterval(() => {
      if (client.busy || busy) return
      void client
        .request<Snapshot>('state')
        .then((value) => {
          if (!disposed) {
            setState(value)
            setStale(false)
          }
        })
        .catch((err) => {
          if (!disposed) {
            setStale(true)
            setError(friendlyError(err))
          }
        })
    }, 1500)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [client, ready, busy])

  async function connect() {
    setError('')
    setNotice('')
    setStatus('connecting')
    setStale(true)
    try {
      const result = await client.connect(link)
      setHello(result)
      setState(result.state)
      setSamples([])
      setStatus('ready')
      setStale(false)
      log(
        '连接',
        `${link === 'usb' ? 'USB' : 'BLE'} · ${result.device_id} · 固件 ${result.firmware}`,
      )
    } catch (err) {
      setStatus('disconnected')
      setError(friendlyError(err))
      log('失败', friendlyError(err))
    }
  }
  async function disconnect() {
    setStatus('disconnected')
    setStale(true)
    setNotice('连接已关闭；设备本地任务会继续运行。')
    await client.disconnect()
    log('连接', '主动断开连接')
  }
  async function act(op: string, params: Record<string, unknown> = {}) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await client.request<Snapshot | Sample>(op, params)
      if ('raw' in result) addSample(result)
      const snapshot = 'pins' in result ? result : await client.request<Snapshot>('state')
      setState(snapshot)
      setStale(false)
      setNotice('设备已执行，状态已同步。')
      log('完成', op)
    } catch (err) {
      setError(friendlyError(err))
      setStale(true)
      log('失败', friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  const release = () => act('pin.release', { pin: selectedPin })
  function exportSamples() {
    const rows = [
      'uptime_ms,pin,raw,millivolts,calibrated',
      ...samples.map(
        (s) => `${s.uptime_ms},${s.pin},${s.raw},${s.millivolts ?? ''},${s.calibrated}`,
      ),
    ]
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'limivia-adc.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="app-shell">
      <a className="skip" href="#workspace">
        跳至工作区
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="LIMIVIA 首页">
          <span className="brand-mark">
            L<span>·</span>
          </span>
          <span>
            LIMIVIA<small>莉米维娅</small>
          </span>
        </a>
        <div className="workspace-label">
          硬件实验室 <span>01</span>
        </div>
        <nav aria-label="实验功能">
          {sections.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${section === item.id ? 'active' : ''}`}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => {
                setSection(item.id)
                setNotice('')
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>
                {item.title}
                <small>{item.note}</small>
              </span>
              <span className="nav-number">{item.number}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="mini-line" />
          <p>
            让软件触及
            <br />
            真实的物理世界。
          </p>
          <small>LIMIVIA / 0.1.0</small>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span> <strong>ESP32-C3</strong>
          </div>
          <span className="local-label">
            <i /> 本机工作台
          </span>
        </header>
        <main id="workspace">
          <div className="page-heading">
            <div>
              <p className="eyebrow">DEVICE WORKSPACE</p>
              <h1>
                从连接，到掌控<span>。</span>
              </h1>
              <p className="subtitle">
                合宙 ESP32-C3 简约版 <span>·</span> 通过 USB 或蓝牙，开始一次真实的实验。
              </p>
            </div>
            <span className="edition">
              CORE / C3
              <br />
              <small>原生 USB · BLE</small>
            </span>
          </div>
          <section className="connection-bar" aria-label="设备连接">
            <div className="connection-state">
              <span className={`status-dot ${ready && !stale ? 'online' : ''}`} />
              <div>
                <strong>
                  {status === 'connecting'
                    ? '正在连接设备…'
                    : ready
                      ? stale
                        ? '等待状态同步'
                        : '设备已就绪'
                      : status === 'lost'
                        ? '连接已丢失'
                        : '等待连接'}
                </strong>
                <small>
                  {hello && ready
                    ? `${hello.device_id} · v${hello.firmware}`
                    : '选择连接方式，并授权浏览器访问设备'}
                </small>
              </div>
            </div>
            <div className="connection-actions">
              <label className="sr-only" htmlFor="transport">
                连接方式
              </label>
              <select
                id="transport"
                value={link}
                disabled={ready || status === 'connecting'}
                onChange={(e) => setLink(e.target.value as LinkKind)}
              >
                <option value="usb">USB 串口</option>
                <option value="ble">BLE 蓝牙</option>
              </select>
              {ready ? (
                <button onClick={() => void disconnect()} disabled={busy}>
                  断开连接
                </button>
              ) : (
                <button
                  className="primary"
                  onClick={() => void connect()}
                  disabled={!supported || status === 'connecting'}
                >
                  {status === 'connecting' ? '连接中…' : '连接设备'}{' '}
                  <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
          </section>
          {!supported && (
            <p className="inline-help">
              当前环境不支持{link === 'usb' ? ' Web Serial' : ' Web Bluetooth'}。请使用支持该能力的
              Chromium 浏览器，并通过 localhost 或 HTTPS 打开；Linux 蓝牙可能需启用浏览器实验特性。
            </p>
          )}
          <div className="feedback" aria-live="polite">
            {error ? (
              <p className="error" role="alert">
                <span aria-hidden="true">!</span>
                {error}
                {ready && (
                  <button className="text-button" disabled={busy} onClick={() => void act('state')}>
                    刷新状态
                  </button>
                )}
              </p>
            ) : notice ? (
              <p>{notice}</p>
            ) : (
              <p>
                {ready
                  ? '所有更改在设备确认后更新。断开浏览器不会停止本地任务。'
                  : '还没有设备数据。连接后可查看真实引脚状态与运行任务。'}
              </p>
            )}
          </div>
          <div className="work-layout">
            <section className="experiment" aria-labelledby="experiment-title">
              <div className="section-heading">
                <div>
                  <span className="section-index">实验 / {activeSection.number}</span>
                  <h2 id="experiment-title">{activeSection.title}</h2>
                </div>
                <span className="pin-badge">GPIO {selectedPin.toString().padStart(2, '0')}</span>
              </div>
              <div className="pin-context">
                <span>当前功能</span>
                <strong>{pinState ? modes[pinState.mode] : '尚未读取'}</strong>
                {stale && state && <span className="stale-label">上次读数 · 已失效</span>}
                <button
                  className="text-button"
                  onClick={() => void release()}
                  disabled={!enabled || !pinState || pinState.mode === 'idle'}
                >
                  释放引脚
                </button>
              </div>
              {section === 'led' && (
                <>
                  <p className="section-description">
                    从板上的 D5 开始。点亮、熄灭，或让亮度缓缓变化，无需额外接线。
                  </p>
                  <div className="led-demo">
                    <div
                      className={`light-symbol ${ready && !stale && (pinState?.level === 1 || activePwm) ? 'lit' : ''}`}
                      aria-hidden="true"
                    >
                      <span />
                    </div>
                    <div>
                      <span className="field-caption">D5 · GPIO 13</span>
                      <h3>
                        {!ready || stale
                          ? '等待设备状态'
                          : activePwm
                            ? activePwm.breath_ms
                              ? '正在呼吸'
                              : `亮度 ${activePwm.duty}%`
                            : pinState?.level === 1
                              ? '已点亮'
                              : '未点亮'}
                      </h3>
                      <p>另一颗 D4 用于连接状态指示</p>
                    </div>
                  </div>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={
                        !enabled || !['idle', 'input', 'output'].includes(pinState?.mode ?? '')
                      }
                      onClick={() =>
                        void act('gpio.set', { pin: 13, mode: 'output', pull: 'none', level: 1 })
                      }
                    >
                      点亮 LED
                    </button>
                    <button
                      disabled={
                        !enabled || !['idle', 'input', 'output'].includes(pinState?.mode ?? '')
                      }
                      onClick={() =>
                        void act('gpio.set', { pin: 13, mode: 'output', pull: 'none', level: 0 })
                      }
                    >
                      熄灭
                    </button>
                    <button
                      disabled={!enabled || !['idle', 'pwm'].includes(pinState?.mode ?? '')}
                      onClick={() =>
                        void act('pwm.set', { pin: 13, frequency: 1000, duty: 80, breath_ms: 2000 })
                      }
                    >
                      呼吸演示
                    </button>
                  </div>
                  <div className="explanation">
                    <span>下一步</span>
                    <p>
                      呼吸演示占用 PWM；切换为开关控制前，先点击“释放引脚”。也可以前往 PWM
                      调制，手动设置亮度和频率。
                    </p>
                  </div>
                </>
              )}
              {section === 'gpio' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void act('gpio.set', {
                      pin,
                      mode: gpioMode,
                      pull: gpioMode === 'input' ? pull : 'none',
                      level,
                    })
                  }}
                >
                  <p className="section-description">
                    读取外部数字信号，或输出高低电平。引脚使用 3.3V 逻辑，连接外设时需要共地。
                  </p>
                  <fieldset disabled={!enabled}>
                    <div className="form-row">
                      <PinSelect value={pin} onChange={setPin} />
                      <label>
                        方向
                        <select value={gpioMode} onChange={(e) => setGpioMode(e.target.value)}>
                          <option value="input">输入 · 读取信号</option>
                          <option value="output">输出 · 驱动信号</option>
                        </select>
                      </label>
                    </div>
                    <div className="form-row">
                      {gpioMode === 'input' ? (
                        <label>
                          内部电阻
                          <select value={pull} onChange={(e) => setPull(e.target.value)}>
                            <option value="none">无上下拉</option>
                            <option value="up">上拉</option>
                            <option value="down">下拉</option>
                          </select>
                        </label>
                      ) : (
                        <label>
                          输出电平
                          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                            <option value="0">低电平 · 0</option>
                            <option value="1">高电平 · 1</option>
                          </select>
                        </label>
                      )}
                    </div>
                    <button className="primary" type="submit">
                      应用引脚配置
                    </button>
                  </fieldset>
                  <div className="reading">
                    <span>当前电平</span>
                    <strong>{pinState?.level ?? '—'}</strong>
                    <small>{stale ? '上次读数，等待同步' : '来自设备状态快照'}</small>
                  </div>
                </form>
              )}
              {section === 'pwm' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void act('pwm.set', { pin, frequency, duty, breath_ms: breath ? breathMs : 0 })
                  }}
                >
                  <p className="section-description">
                    使用硬件 LEDC 输出 PWM。每路独立设置频率，最多同时运行 4 路。
                  </p>
                  <fieldset disabled={!enabled}>
                    <div className="form-row">
                      <PinSelect value={pin} onChange={setPin} />
                      <NumberField
                        label="输出频率"
                        value={frequency}
                        onChange={setFrequency}
                        min={5}
                        max={40000}
                        unit="Hz"
                      />
                    </div>
                    <label className="slider-label">
                      占空比 <strong>{duty}%</strong>
                      <input
                        aria-label="占空比"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={duty}
                        onChange={(e) => setDuty(Number(e.target.value))}
                      />
                    </label>
                    <div className="form-row">
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={breath}
                          onChange={(e) => setBreath(e.target.checked)}
                        />
                        周期呼吸
                      </label>
                      {breath && (
                        <NumberField
                          label="呼吸周期"
                          value={breathMs}
                          onChange={setBreathMs}
                          min={200}
                          max={60000}
                          unit="ms"
                        />
                      )}
                    </div>
                    <div className="button-row">
                      <button className="primary" type="submit">
                        应用 PWM
                      </button>
                      <button
                        type="button"
                        disabled={!activePwm}
                        onClick={() => void act('pwm.stop', { pin })}
                      >
                        停止 PWM
                      </button>
                    </div>
                  </fieldset>
                  <div className="explanation">
                    <span>设备实际配置</span>
                    <p>
                      {activePwm
                        ? `${activePwm.frequency} Hz · ${activePwm.duty}% · ${activePwm.resolution} bit${activePwm.breath_ms ? ' · 呼吸运行中' : ''}`
                        : '该引脚尚未启用 PWM。其他功能占用的引脚需要先释放。'}
                    </p>
                  </div>
                </form>
              )}
              {section === 'adc' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void act('adc.start', { pin: adcPin, interval_ms: intervalMs })
                  }}
                >
                  <p className="section-description">
                    采集 ADC1 模拟信号。测量输入请保持在 0–2.5V，禁止直接接入 5V。
                  </p>
                  <fieldset disabled={!enabled}>
                    <div className="form-row">
                      <PinSelect value={adcPin} onChange={setAdcPin} adc />
                      <NumberField
                        label="采样间隔"
                        value={intervalMs}
                        onChange={setIntervalMs}
                        min={100}
                        max={10000}
                        unit="ms"
                      />
                    </div>
                    <div className="button-row">
                      <button className="primary" type="submit">
                        {activeStream ? '更新采样间隔' : '开始采集'}
                      </button>
                      <button type="button" onClick={() => void act('adc.read', { pin: adcPin })}>
                        读取一次
                      </button>
                      <button
                        type="button"
                        disabled={pinState?.mode !== 'adc'}
                        onClick={() => void act('adc.stop', { pin: adcPin })}
                      >
                        停止并释放
                      </button>
                    </div>
                  </fieldset>
                  <div className="adc-readings">
                    <div>
                      <span>原始读数</span>
                      <strong>
                        {sample?.raw ?? '—'}
                        <small>/ 4095</small>
                      </strong>
                    </div>
                    <div>
                      <span>{sample?.calibrated ? '校准电压' : '电压'}</span>
                      <strong>
                        {sample?.millivolts ?? '—'}
                        <small>mV</small>
                      </strong>
                    </div>
                  </div>
                  <Chart samples={samples.filter((s) => s.pin === adcPin).slice(-60)} />
                  <div className="chart-footer">
                    <span>
                      {stale
                        ? '连接失效 · 历史采样'
                        : sample
                          ? `设备时间 ${(sample.uptime_ms / 1000).toFixed(1)} s${sample.calibrated ? '' : ' · 无可用校准'}`
                          : '等待首次采样'}
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!samples.length}
                      onClick={exportSamples}
                    >
                      导出 CSV
                    </button>
                  </div>
                </form>
              )}
              {section === 'timer' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void act('timer.start', {
                      pin,
                      kind: timerKind,
                      high_ms: highMs,
                      low_ms: lowMs,
                      count,
                    })
                  }}
                >
                  <p className="section-description">
                    任务在芯片本地运行。关闭网页后继续，重新连接可查看与停止；重启后清空。
                  </p>
                  <fieldset disabled={!enabled}>
                    <div className="form-row">
                      <PinSelect value={pin} onChange={setPin} />
                      <label>
                        任务类型
                        <select value={timerKind} onChange={(e) => setTimerKind(e.target.value)}>
                          <option value="blink">周期闪烁</option>
                          <option value="pulse">单次高电平脉冲</option>
                        </select>
                      </label>
                    </div>
                    <div className="form-row">
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
                          />
                        </>
                      )}
                    </div>
                    <button className="primary" type="submit">
                      启动本地任务
                    </button>
                  </fieldset>
                  <div className="task-list">
                    <h3>
                      运行中的任务 <span>{state?.timers.length ?? '—'} / 4</span>
                    </h3>
                    {state?.timers.length ? (
                      state.timers.map((task) => (
                        <div className="task-row" key={task.id}>
                          <span>
                            GPIO {task.pin}
                            <small>
                              {task.kind === 'pulse'
                                ? '单次脉冲'
                                : `${task.high_ms} / ${task.low_ms} ms · ${task.count || '持续'} 次`}
                            </small>
                          </span>
                          <button
                            type="button"
                            disabled={!enabled}
                            onClick={() => void act('timer.stop', { pin: task.pin })}
                          >
                            停止
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="empty-text">
                        {ready ? '还没有运行中的任务' : '连接后读取设备任务'}
                      </p>
                    )}
                  </div>
                </form>
              )}
            </section>
            <aside className="device-panel" aria-label="开发板上下文">
              <div className="panel-heading">
                <h2>设备视图</h2>
                <span>ESP32-C3</span>
              </div>
              <Board state={state} selected={selectedPin} ready={ready && !stale} />
              <dl>
                <div>
                  <dt>连接通道</dt>
                  <dd>
                    {ready ? (link === 'usb' ? 'USB Serial/JTAG' : 'Bluetooth LE') : '未连接'}
                  </dd>
                </div>
                <div>
                  <dt>运行时间</dt>
                  <dd>
                    {state
                      ? `${Math.floor(state.uptime_ms / 1000)} s${stale ? ' · 旧值' : ''}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>PWM 资源</dt>
                  <dd>{state ? `${state.pwm.length} / 4` : '—'}</dd>
                </div>
                <div>
                  <dt>本地任务</dt>
                  <dd>{state ? `${state.timers.length} / 4` : '—'}</dd>
                </div>
              </dl>
              <div className="board-note">
                <strong>引脚保护已启用</strong>
                <p>USB 18/19、Flash 与启动配置引脚不开放实验操作。D4 由系统管理。</p>
              </div>
              <button
                className="stop-all"
                disabled={!ready || busy}
                onClick={() => void act('outputs.stop')}
              >
                停止全部输出
              </button>
              <small className="stop-note">停止 PWM、定时与采集，释放实验引脚</small>
            </aside>
          </div>
          <details className="console">
            <summary>
              <span>命令与事件</span>
              <span className="console-count">
                {logs.length} 条记录 <span aria-hidden="true">⌄</span>
              </span>
            </summary>
            <div className="console-toolbar">
              <span>仅保留当前页面最近 200 条记录</span>
              <button className="text-button" onClick={() => setLogs([])}>
                清空
              </button>
            </div>
            <div className="console-body" tabIndex={0} aria-label="命令日志">
              {logs.length ? (
                logs.map((entry) => (
                  <div className="log-row" key={entry.id}>
                    <time>{entry.time}</time>
                    <span>{entry.direction}</span>
                    <code>{entry.text}</code>
                  </div>
                ))
              ) : (
                <p className="empty-text">连接设备后，操作结果会记录在这里。</p>
              )}
            </div>
          </details>
          <footer className="page-footer">
            <span>LIMIVIA · 探索，从一次可理解的操作开始。</span>
            <span>本机连接 / 实时反馈</span>
          </footer>
        </main>
      </div>
    </div>
  )
}
