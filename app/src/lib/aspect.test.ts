import { describe, expect, it } from 'vitest'
import { cssRatio, normalizeRatio, ratioValue, stageSize } from './aspect'

describe('aspect ratio', () => {
  it('reads w:h', () => {
    expect(ratioValue('16:9')).toBeCloseTo(1.778, 3)
    expect(ratioValue('2.39:1')).toBeCloseTo(2.39, 3)
    expect(ratioValue('9:16')).toBeCloseTo(0.5625, 4)
    expect(ratioValue('nonsense')).toBeCloseTo(16 / 9, 5)
    expect(ratioValue(null)).toBeCloseTo(16 / 9, 5)
  })
  it('makes the stage 1280 on the long side', () => {
    expect(stageSize('16:9')).toEqual({ w: 1280, h: 720 })
    expect(stageSize('2.39:1')).toEqual({ w: 1280, h: 536 })
    expect(stageSize('1:1')).toEqual({ w: 1280, h: 1280 })
    expect(stageSize('9:16')).toEqual({ w: 720, h: 1280 })
    expect(stageSize('4:3')).toEqual({ w: 1280, h: 960 })
  })
  it('normalises what a person types', () => {
    expect(normalizeRatio('2.39')).toBe('2.39:1')
    expect(normalizeRatio('2,39')).toBe('2.39:1')
    expect(normalizeRatio('16/9')).toBe('16:9')
    expect(normalizeRatio(' 4 x 3 ')).toBe('4:3')
    expect(normalizeRatio('1.85 : 1')).toBe('1.85:1')
  })
  it('refuses shapes that make no sense', () => {
    expect(normalizeRatio('wide')).toBeNull()
    expect(normalizeRatio('0:9')).toBeNull()
    expect(normalizeRatio('40:1')).toBeNull()
    expect(normalizeRatio('')).toBeNull()
    expect(normalizeRatio('1.23456:1')).toBeNull()
  })
  it('gives CSS a plain number', () => {
    expect(cssRatio('16:9')).toBe('1.778')
    expect(cssRatio('1:1')).toBe('1')
  })
})
