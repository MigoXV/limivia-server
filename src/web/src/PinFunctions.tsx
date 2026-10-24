import { useId, useState } from 'react'
import { kindNames, type Capability } from './device'

const groups = [
  { name: '电平与采样', families: ['gpio', 'pwm', 'adc'] },
  { name: '通信', families: ['uart', 'i2c', 'spi', 'twai', 'i2s'] },
  { name: '波形与定时', families: ['rmt', 'timer', 'sigma_delta'] },
]
const names: Record<string, string> = { i2c: 'I²C', spi: 'SPI', rmt: 'RMT', adc: 'ADC' }
const descriptions: Record<string, string> = {
  gpio: '输入 / 输出',
  pwm: '占空比',
  adc: '电压采样',
  uart: '串口',
  twai: '帧收发',
  timer: '周期 / 延时',
  i2s: '音频 / PDM',
  sigma_delta: '密度调制',
}

export function PinFunctions({
  functions,
  onChoose,
}: {
  functions: Capability[]
  onChoose: (capability: Capability) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const id = useId()
  const familyOf = (c: Capability) => c.kind.split('.')[0]
  const known = new Set(groups.flatMap((g) => g.families))
  const sections = [
    ...groups,
    {
      name: '其他功能',
      families: [...new Set(functions.map(familyOf).filter((f) => !known.has(f)))],
    },
  ]
  return (
    <div className="pin-functions" aria-label="引脚可用功能">
      {sections.map((group) => {
        const families = group.families.filter((family) =>
          functions.some((c) => familyOf(c) === family),
        )
        if (!families.length) return null
        return (
          <div className="function-group" key={group.name}>
            <h3>{group.name}</h3>
            {families.map((family) => {
              const caps = functions.filter((c) => familyOf(c) === family)
              const open = expanded === family
              const name = names[family] ?? kindNames[family] ?? family
              return (
                <div className="function-family" key={family}>
                  <button
                    type="button"
                    className="function-row"
                    aria-expanded={caps.length > 1 ? open : undefined}
                    aria-controls={caps.length > 1 ? `${id}-${family}` : undefined}
                    onClick={() =>
                      caps.length > 1 ? setExpanded(open ? null : family) : onChoose(caps[0])
                    }
                  >
                    <strong>{name}</strong>
                    <small>
                      {caps.length > 1
                        ? family === 'rmt'
                          ? '发射 / 接收'
                          : `${caps.length} 种模式`
                        : descriptions[family]}
                    </small>
                    <i
                      className={open ? 'family-chevron expanded' : 'family-chevron'}
                      aria-hidden="true"
                    />
                  </button>
                  {caps.length > 1 && open && (
                    <div className="function-subtypes" id={`${id}-${family}`}>
                      {caps.map((cap) => (
                        <button
                          type="button"
                          className="function-row"
                          key={cap.kind}
                          onClick={() => onChoose(cap)}
                        >
                          {kindNames[cap.kind] ?? cap.kind}
                          <i className="family-chevron" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
