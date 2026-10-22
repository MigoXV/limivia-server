import { useEffect, useId, useRef, type ReactNode } from 'react'
import { PIN_NUMBERS, type Sample } from './device'

export function Dialog({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current!
    const opener = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      dialog.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={id}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.stopPropagation()
        event.preventDefault()
        onClose()
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <button className="text-button" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      {children}
    </dialog>
  )
}

export function ModeSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="mode-switch" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function PinSelect({
  value,
  onChange,
  adc = false,
  available = PIN_NUMBERS,
}: {
  value: number
  onChange: (value: number) => void
  adc?: boolean
  available?: number[]
}) {
  return (
    <label className="pin-field">
      目标引脚
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {available
          .filter((pin) => !adc || [0, 1, 3, 4].includes(pin))
          .map((pin) => (
            <option key={pin} value={pin}>
              GPIO {pin}
              {adc ? ' · ADC1' : pin === 13 ? ' · D5 LED' : ''}
            </option>
          ))}
      </select>
    </label>
  )
}

export function NumberField({
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
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  unit?: string
}) {
  return (
    <label className="number-label">
      {label}
      <span className="number-field">
        <input
          type="number"
          required
          min={min}
          max={max}
          step={step}
          value={Number.isNaN(value) ? '' : value}
          onChange={(event) => onChange(event.target.valueAsNumber)}
        />
        {unit && <span aria-hidden="true">{unit}</span>}
      </span>
    </label>
  )
}

export function LedIndicator({
  state,
}: {
  state: 'unknown' | 'pending' | 'off' | 'on' | 'breath'
}) {
  return (
    <div className={`led-indicator ${state}`} aria-hidden="true">
      <div className="led-symbol">
        <i className="led-leg" />
        <i className="led-leg" />
        <span className="led-package">
          {state === 'unknown' ? '?' : state === 'pending' ? '…' : null}
        </span>
        {state === 'breath' && (
          <span className="breath-bars">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      <span>{state === 'breath' ? '呼吸示意' : '输出示意'}</span>
    </div>
  )
}

export function Chart({ samples, stale }: { samples: Sample[]; stale: boolean }) {
  const calibrated =
    samples.length > 0 && samples.every((sample) => sample.calibrated && sample.millivolts !== null)
  const maximum = calibrated ? Math.max(2500, ...samples.map((sample) => sample.millivolts!)) : 4095
  const points = samples.map((sample, index) => {
    const value = calibrated ? sample.millivolts! : sample.raw
    return `${(index / Math.max(samples.length - 1, 1)) * 976},${175 - (value / maximum) * 159}`
  })
  return (
    <div className="chart-section">
      <div className="chart-heading">
        <h2>{calibrated || !samples.length ? '电压趋势' : '原始读数趋势'}</h2>
        <span>
          {stale ? '历史采样 · 已过期' : samples.length ? '来自设备采样' : '等待首次采样'}
        </span>
      </div>
      <div
        className="chart"
        role="img"
        aria-label={
          samples.length
            ? `最近 ${samples.length} 个 ADC ${calibrated ? '电压' : '原始'}采样值${stale ? '，已过期' : ''}`
            : '尚无 ADC 采样数据'
        }
      >
        <div className="chart-scale" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} style={{ top: 9 + index * 53 }}>
              {Math.round(((samples.length ? maximum : 2500) * (3 - index)) / 3)}
            </span>
          ))}
          <span className="chart-unit">{calibrated || !samples.length ? 'mV' : 'raw'}</span>
        </div>
        <svg viewBox="0 0 976 212" preserveAspectRatio="none" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <line
              key={index}
              x1="0"
              x2="976"
              y1={16 + index * 53}
              y2={16 + index * 53}
              className="grid-line"
            />
          ))}
          {points.length > 1 && (
            <polyline points={points.join(' ')} fill="none" className="signal-line" />
          )}
          {points.length === 1 && (
            <circle cx="0" cy={points[0].split(',')[1]} r="0.01" className="signal-dot" />
          )}
        </svg>
        {!samples.length && <p className="chart-empty">尚无采样数据 · 开始采样后显示曲线</p>}
      </div>
      <div className="chart-axis">
        <span>较早</span>
        <span>最近一帧</span>
      </div>
    </div>
  )
}
