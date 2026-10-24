import { describe, it, expect } from 'vitest'
import { initialState, type Capability } from './device'
import { groupPins, newGroup, pinFunctions } from './wiring'
const gpio: Capability = {
  kind: 'gpio',
  available: true,
  capacity: 10,
  pin_roles: 'pin',
  required_pins: 'pin',
  config: [],
  actions: [],
}
describe('板卡与接线投影', () => {
  it('从实际引脚与固件能力筛选功能，保护脚不提供配置', () => {
    const state = {
      ...initialState,
      discovery: {
        identity: null!,
        pins: [
          { pin: 4, digital: true, adc1: true, deep_sleep_wake: false },
          { pin: 12, digital: true, adc1: false, deep_sleep_wake: false },
        ],
        resources: [gpio, { ...gpio, kind: 'pwm', available: false }, { ...gpio, kind: 'adc' }],
        operations: [],
        raw_pages: [],
      },
    }
    expect(pinFunctions(state, 4).map((c) => c.kind)).toEqual(['gpio', 'adc'])
    expect(pinFunctions(state, 12)).toEqual([])
    expect(pinFunctions(initialState, 4)).toEqual([])
  })
  it('子设备继承总线引脚，但不会重复创建父总线', () => {
    const parent = { ...newGroup(gpio, 4, 'sda'), id: 'bus', pins: { sda: 4, scl: 5 } }
    const child = { ...newGroup(gpio), id: 'sensor', parent_group: 'bus' }
    expect(groupPins(child, [parent, child])).toEqual([4, 5])
    expect(child.pins).toEqual({})
    expect(
      groupPins({ ...parent, parent_group: 'sensor' }, [
        { ...parent, parent_group: 'sensor' },
        child,
      ]),
    ).toEqual([4, 5])
  })
  it('选中的起始引脚仅绑定所选角色，草稿没有运行句柄', () => {
    const group = newGroup({ ...gpio, kind: 'uart', pin_roles: 'tx rx' }, 4, 'rx')
    expect(group.pins).toEqual({ rx: 4 })
    expect(group).not.toHaveProperty('resource')
  })
})
