import { describe, it, expect } from 'vitest'
import {
  decodeBinary,
  adcSamples,
  boardState,
  initialState,
  terminal,
  type Operation,
} from './device'
describe('v3 business projections', () => {
  it('validates canonical binary and length', () => {
    expect([...decodeBinary({ data: 'AQI=', length: 2 })]).toEqual([1, 2])
    expect(() => decodeBinary({ data: 'AQI=', length: 1 })).toThrow()
    expect(() => decodeBinary({ data: 'AR==', length: 1 })).toThrow()
  })
  it('decodes periodic ADC as little endian records and preserves uncalibrated mV', () => {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setInt32(0, 2048, true)
    view.setInt32(4, -1, true)
    const value = adcSamples(
      { events: [{ data: btoa(String.fromCharCode(...bytes)), sequence: 3 }] },
      4,
      9,
    )[0]
    expect(value.raw).toBe(2048)
    expect(value.millivolts).toBeNull()
    expect(value.calibrated).toBe(false)
    expect(value.pin).toBe(4)
  })
  it('does not infer completion from accepted or notifications', () => {
    expect(terminal({ status: 'accepted' } as Operation)).toBe(false)
    expect(terminal({ status: 'unknown' } as Operation)).toBe(true)
  })
  it('board is an empty read-only projection before discovery', () => {
    expect(boardState(initialState).pins.every((p) => p.mode === 'idle')).toBe(true)
    expect(boardState(initialState).sessions[0].active).toBe(false)
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Result } from './Forms'
describe('readable typed results', () => {
  it('shows uncalibrated ADC without inventing zero mV', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { value: { raw: 2048, millivolts: null } }),
    )
    expect(html).toContain('未校准')
    expect(html).toContain('2048')
  })
  it('preserves continuous ADC tags and raw units', () => {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, (3 << 13) | (1 << 16) | 2000, true)
    const html = renderToStaticMarkup(
      createElement(Result, {
        format: 'adc.continuous',
        value: { length: 4, data: btoa(String.fromCharCode(...bytes)) },
      }),
    )
    expect(html).toContain('ADC type2')
    expect(html).toContain('2000')
    expect(html).toContain('无校准电压单位')
  })
  it('explains queued delivery without claiming remote success', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { value: { delivery: 'queued', message_id: 7 } }),
    )
    expect(html).toContain('本地已入队（非应用确认）')
  })
})
