import { describe, expect, it } from 'vitest'
import { dayEntries, scenesOnAnyDay, shotDayId, addDays, eighthsLabel, formatRange, headingParts, matchCast, nextFreeDate, pageLength, placeAt } from './schedule'
import type { CrewRow } from './castcrew'

describe('headingParts', () => {
  it('reads interior and time of day', () => {
    expect(headingParts('INT. KITCHEN - NIGHT')).toEqual({ ie: 'INT', tod: 'NIGHT' })
    expect(headingParts('EXT. HARBOUR - DAWN')).toEqual({ ie: 'EXT', tod: 'DAWN' })
    expect(headingParts('INT./EXT. CAR - DAY')).toEqual({ ie: 'INT/EXT', tod: 'DAY' })
  })
  it('copes with headings it does not understand', () => {
    expect(headingParts('THE LONG ROAD')).toEqual({ ie: '', tod: '' })
    expect(headingParts('')).toEqual({ ie: '', tod: '' })
  })
})
describe('page length', () => {
  it('counts in eighths and never shows zero', () => {
    expect(pageLength(1)).toBe('1/8')
    expect(pageLength(55)).toBe('1')
    expect(pageLength(75)).toBe('1 3/8')
    expect(eighthsLabel(16)).toBe('2')
    expect(eighthsLabel(3)).toBe('3/8')
  })
})
describe('dates', () => {
  it('adds days across a month end without time zone drift', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
  })
  it('formats a range', () => {
    expect(formatRange('2026-03-02', '2026-03-13')).toBe('2 Mar 2026 to 13 Mar 2026')
    expect(formatRange('2026-03-02', '2026-03-02')).toBe('2 Mar 2026')
  })
  it('finds the next free date', () => {
    const s = { start_date: '2026-03-02', end_date: '2026-03-04' }
    expect(nextFreeDate(s, [])).toBe('2026-03-02')
    expect(nextFreeDate(s, ['2026-03-02'])).toBe('2026-03-03')
    expect(nextFreeDate(s, ['2026-03-03'])).toBe('2026-03-04')
    expect(nextFreeDate(s, ['2026-03-04'])).toBe('2026-03-02')
    expect(nextFreeDate(s, ['2026-03-02', '2026-03-03', '2026-03-04'])).toBeNull()
  })
})
describe('placeAt', () => {
  it('moves within and into a day', () => {
    expect(placeAt(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(placeAt(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(placeAt(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b'])
    expect(placeAt([], 'x', 5)).toEqual(['x'])
  })
})
describe('matchCast', () => {
  const rows = [{ kind: 'cast', role: 'Anna', name: 'Maya Lin' }, { kind: 'crew', role: 'Gaffer', name: 'Sam' }] as CrewRow[]
  it('matches by character or actor and ignores crew', () => {
    expect(matchCast('ANNA', rows)).toHaveLength(1)
    expect(matchCast('maya lin', rows)).toHaveLength(1)
    expect(matchCast('Sam', rows)).toHaveLength(0)
    expect(matchCast('', rows)).toHaveLength(0)
  })
})

describe('shots on their own days', () => {
  const pl = [{ schedule_id: 's', scene_id: 'A', project_id: 'p', day_id: 'd1', sort_order: 0 }, { schedule_id: 's', scene_id: 'B', project_id: 'p', day_id: 'd1', sort_order: 10 }]
  const shots = [{ id: 'a1', scene_id: 'A', position: 10 }, { id: 'a2', scene_id: 'A', position: 20 }, { id: 'a3', scene_id: 'A', position: 30 }, { id: 'b1', scene_id: 'B', position: 10 }, { id: 'c1', scene_id: 'C', position: 10 }]
  const own = [{ schedule_id: 's', shot_id: 'a3', project_id: 'p', day_id: 'd2', sort_order: 0 }, { schedule_id: 's', shot_id: 'c1', project_id: 'p', day_id: 'd2', sort_order: 0 }]
  it('a shot follows its scene unless it has its own day', () => {
    expect(shotDayId(shots[0], pl, own)).toBe('d1')
    expect(shotDayId(shots[2], pl, own)).toBe('d2')
    expect(shotDayId(shots[4], pl, [])).toBeNull()
  })
  it('lists whole scenes with their shots, then scenes that are on a day only through some shots', () => {
    expect(dayEntries('d1', pl, own, shots)).toEqual([{ scene_id: 'A', shot_ids: ['a1', 'a2'], whole: true }, { scene_id: 'B', shot_ids: ['b1'], whole: true }])
    expect(dayEntries('d2', pl, own, shots).sort((x, y) => x.scene_id.localeCompare(y.scene_id))).toEqual([{ scene_id: 'A', shot_ids: ['a3'], whole: false }, { scene_id: 'C', shot_ids: ['c1'], whole: false }])
  })
  it('a placed scene stays on its day even when all its shots go elsewhere', () => {
    const all = [...own, { schedule_id: 's', shot_id: 'b1', project_id: 'p', day_id: 'd2', sort_order: 0 }]
    expect(dayEntries('d1', pl, all, shots).find((e) => e.scene_id === 'B')).toEqual({ scene_id: 'B', shot_ids: [], whole: true })
  })
  it('knows which scenes are on any day', () => {
    expect([...scenesOnAnyDay(pl, own, shots)].sort()).toEqual(['A', 'B', 'C'])
  })
})
