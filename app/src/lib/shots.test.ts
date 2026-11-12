import { describe, expect, it } from 'vitest'
import { reorderChanges, type Shot, sizeName } from './shots'

const mk = (id: string, position: number) => ({ id, position }) as Shot
describe('reorderChanges', () => {
  const list = [mk('a', 10), mk('b', 20), mk('c', 30)]
  it('drops into a gap by moving one shot only', () => {
    const r = reorderChanges(list, 'c', 0)
    expect(r).toEqual([{ id: 'c', position: 5 }])
  })
  it('moves to the end', () => {
    expect(reorderChanges(list, 'a', 2)).toEqual([{ id: 'a', position: 40 }])
  })
  it('does nothing when it stays put', () => {
    expect(reorderChanges(list, 'b', 1)).toEqual([])
  })
  it('spaces the scene out again when there is no gap', () => {
    const tight = [mk('a', 1), mk('b', 2), mk('c', 3)]
    const r = reorderChanges(tight, 'c', 1)
    expect(r.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'].filter((x) => r.some((y) => y.id === x)).sort())
    const final = [...tight.map((s) => ({ ...s, ...(r.find((x) => x.id === s.id) ?? {}) }))].sort((x, y) => x.position - y.position).map((s) => s.id)
    expect(final).toEqual(['a', 'c', 'b'])
  })
})

describe('sizeName', () => { it('shows short forms as full names and leaves others alone', () => { expect(sizeName('CU')).toBe('Close-up'); expect(sizeName(' ms ')).toBe('Medium shot'); expect(sizeName('Dutch angle')).toBe('Dutch angle'); expect(sizeName('')).toBe('') }) })
