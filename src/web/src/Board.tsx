import { useRef, useState } from 'react'
import type { Snapshot } from './device'
import { BOARD_PINS, displaySide, type BoardFace, type BoardPin } from './board'

export function Board({
  state,
  selected,
  ready,
}: {
  state: Snapshot | null
  selected: number
  ready: boolean
}) {
  const [face, setFace] = useState<BoardFace>('front')
  const [inspected, setInspected] = useState<BoardPin | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const detail = inspected ?? BOARD_PINS.find((p) => p.gpio === selected)!
  const front = face === 'front'
  const controls = () => (
    <div className="board-controls" role="group" aria-label="观察方向">
      <button type="button" aria-pressed={front} onClick={() => setFace('front')}>
        正面
      </button>
      <button type="button" aria-pressed={!front} onClick={() => setFace('back')}>
        背面
      </button>
    </div>
  )
  const diagram = () => (
    <svg
      className="board"
      viewBox="0 0 360 660"
      role="group"
      aria-label={`合宙 CORE ESP32-C3 ${front ? '正面' : '背面'}接线图，32 个引脚，USB 在下`}
    >
      <rect className="pcb" x="85" y="15" width="190" height="620" rx="8" />
      {front ? (
        <>
          <path className="antenna" d="M120 55V30h20v25h20V30h20v25h20V30h20v25h20V30h15v30" />
          <rect className="chip" x="140" y="190" width="80" height="90" rx="3" />
          <text className="chip-label" x="180" y="228" textAnchor="middle">
            ESP32
          </text>
          <text className="chip-label" x="180" y="254" textAnchor="middle">
            C3
          </text>
          <text className="board-small" x="180" y="340" textAnchor="middle">
            CORE · USB
          </text>
          {['RST', 'BOOT'].map((label, i) => (
            <g key={label}>
              <rect className="usb" x={120 + i * 80} y="455" width="40" height="30" rx="3" />
              <text className="board-small" x={140 + i * 80} y="503" textAnchor="middle">
                {label}
              </text>
            </g>
          ))}
          {['D5', 'D4'].map((label, i) => (
            <g key={label}>
              <circle
                className={
                  ready &&
                  (i === 0
                    ? state?.pins.find((p) => p.pin === 13)?.level === 1
                    : state?.sessions.some((session) => session.active))
                    ? 'led active'
                    : 'led'
                }
                cx={140 + i * 80}
                cy="550"
                r="6"
              />
              <text className="board-small" x={140 + i * 80} y="574" textAnchor="middle">
                {label}
              </text>
            </g>
          ))}
        </>
      ) : (
        <text className="board-small" x="180" y="320" textAnchor="middle">
          背面 · 左右翻转
        </text>
      )}
      <rect className="usb" x="155" y="595" width="50" height="50" rx="5" />
      <text className="board-small" x="180" y="625" textAnchor="middle">
        USB
      </text>
      {BOARD_PINS.map((pin) => {
        const right = displaySide(pin, face) === 'right'
        const y = 90 + pin.row * 32
        return (
          <g
            key={pin.id}
            role="button"
            tabIndex={0}
            aria-label={`${pin.id} ${pin.label}${pin.gpio === undefined ? '' : ` GPIO ${pin.gpio}`}，${pin.description}`}
            aria-pressed={detail.id === pin.id}
            data-pin-id={pin.id}
            data-side={right ? 'right' : 'left'}
            data-category={pin.category}
            className={`pin pin-${pin.category}${pin.gpio === selected ? ' selected-pin' : ''}${detail.id === pin.id ? ' inspected-pin' : ''}`}
            onClick={() => setInspected(pin)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setInspected(pin)
              }
            }}
          >
            <title>{pin.description}</title>
            <rect className="pin-hit" x={right ? 266 : 0} y={y - 14} width="94" height="30" />
            <rect
              className="pin-pad"
              x={right ? 266 : 78}
              y={y - 7}
              width="16"
              height="14"
              rx="2"
            />
            <text x={right ? 290 : 70} y={y + 5} textAnchor={right ? 'start' : 'end'}>
              {pin.label}
              {pin.protected ? '*' : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
  const information = () => (
    <>
      <p className="board-orientation">
        {front ? '正面 · 元件朝向你' : '背面 · 左右已翻转'} · 天线上 / USB 下
      </p>
      <div className="board-legend">
        {[
          ['5v', '5V'],
          ['ground', 'GND'],
          ['3v3', '3.3V'],
          ['analog', 'ADC 能力'],
          ['digital', '数字信号'],
        ].map(([category, label]) => (
          <span key={category} className={`pin-${category}`}>
            <i />
            {label}
          </span>
        ))}
      </div>
      <p className="board-detail" aria-live="polite">
        <strong>
          {detail.label}
          {detail.gpio === undefined ? '' : ` / GPIO ${detail.gpio}`}
        </strong>
        <br />
        {detail.description}
      </p>
      <p className="board-help">
        * 受保护 · 外框为实验目标 GPIO {selected}。点击引脚仅查看信息。蓝色表示芯片 ADC 能力；PWM
        并非 DAC 模拟输出。
      </p>
    </>
  )
  return (
    <div className="board-wrap">
      {controls()}
      {diagram()}
      {information()}
      <button className="board-expand" type="button" onClick={() => dialog.current?.showModal()}>
        放大接线图
      </button>
      <dialog ref={dialog} className="board-dialog" aria-labelledby="board-dialog-title">
        <div className="board-dialog-heading">
          <h2 id="board-dialog-title">实物接线图 · 32 引脚</h2>
          <button type="button" onClick={() => dialog.current?.close()}>
            关闭接线图
          </button>
        </div>
        {controls()}
        <div className="board-scroll">{diagram()}</div>
        {information()}
      </dialog>
    </div>
  )
}
