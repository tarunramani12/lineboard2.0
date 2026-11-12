import { describe, expect, it } from 'vitest'
import { addPoint, gridCells, mb, totalBytes, type Frame } from './storyboard'

describe('storyboard helpers', () => {
  it('rounds points and skips ones almost on top of the last', () => {
    let p: [number, number][] = []
    p = addPoint(p, 0.12345, 0.5); p = addPoint(p, 0.1236, 0.5001); p = addPoint(p, 0.2, 0.6)
    expect(p).toEqual([[0.123, 0.5], [0.2, 0.6]])
  })
  it('lays six frames on a landscape page', () => {
    const cells = gridCells(792, 612, 36, 3, 2, 12)
    expect(cells).toHaveLength(6)
    expect(cells[0]).toMatchObject({ x: 36, y: 36 })
    expect(cells[2].x + cells[2].w).toBeCloseTo(792 - 36)
    expect(cells[5].y + cells[5].h).toBeCloseTo(612 - 36)
  })
  it('adds up sizes and prints megabytes', () => {
    const f = (bytes: number) => ({ bytes }) as Frame
    expect(totalBytes([f(1000), f(2000)])).toBe(3000)
    expect(mb(1572864)).toBe('1.5')
    expect(mb(50 * 1048576)).toBe('50')
  })
})
