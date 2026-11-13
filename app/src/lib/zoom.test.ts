import { describe, expect, it } from 'vitest'
import { clampZoom, fitWidthZoom, parseZoom, pinchZoom, stepZoom } from './zoom'

describe('script zoom', () => {
  it('keeps the percentage between 50 and 200', () => {
    expect(clampZoom(10)).toBe(50)
    expect(clampZoom(900)).toBe(200)
    expect(clampZoom(NaN)).toBe(100)
    expect(clampZoom(101.4)).toBe(101)
  })
  it('steps up and down through 50, 75, 100, 125, 150, 200', () => {
    expect(stepZoom(100, 1)).toBe(125)
    expect(stepZoom(100, -1)).toBe(75)
    expect(stepZoom(200, 1)).toBe(200)
    expect(stepZoom(50, -1)).toBe(50)
    expect(stepZoom(110, 1)).toBe(125)
    expect(stepZoom(110, -1)).toBe(100)
  })
  it('fit width fills the width but never goes under 100', () => {
    expect(fitWidthZoom(1290)).toBe(150)
    expect(fitWidthZoom(390)).toBe(100)
    expect(fitWidthZoom(4000)).toBe(200)
    expect(fitWidthZoom(0)).toBe(100)
  })
  it('reads a saved value', () => {
    expect(parseZoom('fit')).toBe('fit')
    expect(parseZoom('125')).toBe(125)
    expect(parseZoom('bad')).toBe(100)
    expect(parseZoom(null)).toBe(100)
  })
  it('pinch scales the starting percentage in steps of 5', () => {
    expect(pinchZoom(100, 100, 150)).toBe(150)
    expect(pinchZoom(100, 100, 50)).toBe(50)
    expect(pinchZoom(100, 100, 400)).toBe(200)
    expect(pinchZoom(100, 0, 10)).toBe(100)
  })
})
