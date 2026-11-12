import { describe, expect, it } from 'vitest'
import { buildSnapshot, diffCount, diffSnapshots, type SheetSnapshot } from './callsheets'
import type { CrewRow } from './castcrew'
import type { Scene } from './types'
import type { ShootDay } from './schedule'

const day = (id: string, date: string, location = ''): ShootDay => ({ id, project_id: 'p', schedule_id: 's', day_date: date, location, notes: '' })
const scene = (id: string, n: string, heading: string) => ({ id, display_number: n, heading } as unknown as Scene)
const row = (over: Partial<CrewRow>) => ({ id: Math.random().toString(), kind: 'crew', name: '', role: '', department: '', call_time: '', makeup_time: '', account_id: null, ...over } as CrewRow)

const base = () => buildSnapshot({
  project: 'Film', schedule: 'Block 1', days: [day('d1', '2026-03-02'), day('d2', '2026-03-03')], day: day('d2', '2026-03-03', 'Harbour'),
  draft: { general_call: '07:00', hospital: 'City', notes: '' },
  scenes: [scene('a', '1', 'INT. KITCHEN - DAY'), scene('b', '2', 'EXT. HARBOUR - NIGHT')],
  sceneInfo: (s) => ({ pages: '1', cast: s.id === 'a' ? ['Anna', 'Bob'] : ['Anna'] }),
  castRows: [row({ id: 'c1', kind: 'cast', name: 'Maya', role: 'Anna', call_time: '08:00', makeup_time: '07:15' })],
  crewRows: [row({ id: 'k1', name: 'Sam', role: 'Gaffer', department: 'Lighting and grip' }), row({ id: 'k2', name: 'Lee', role: 'Director', department: 'Direction' }), row({ id: 'k3', kind: 'cast', name: 'Maya' })],
  sceneLabel: (s) => s.display_number ?? '',
})

describe('buildSnapshot', () => {
  it('gathers the day, scenes, cast and crew by team', () => {
    const s = base()
    expect(s).toMatchObject({ day_no: 2, day_count: 2, date: '2026-03-03', location: 'Harbour', general_call: '07:00' })
    expect(s.scenes.map((x) => [x.number, x.ie, x.tod])).toEqual([['1', 'INT', 'DAY'], ['2', 'EXT', 'NIGHT']])
    expect(s.cast).toEqual([
      { id: 'c1', character: 'Anna', actor: 'Maya', call: '08:00', makeup: '07:15' },
      { id: 'name:bob', character: 'Bob', actor: '', call: '', makeup: '' },
    ])
    expect(s.crew.map((d) => d.department)).toEqual(['Direction', 'Lighting and grip'])
  })
})

describe('diffSnapshots', () => {
  it('marks nothing for a first issue or an identical sheet', () => {
    expect(diffCount(diffSnapshots(null, base()))).toBe(0)
    expect(diffCount(diffSnapshots(base(), base()))).toBe(0)
  })
  it('ignores the key order the database gives back', () => {
    const prev = base()
    const reordered = JSON.parse(JSON.stringify(prev, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)))
    expect(diffCount(diffSnapshots(reordered, prev))).toBe(0)
  })
  it('marks changed details, scenes, cast and crew, and lists what was removed', () => {
    const prev = base(); const next: SheetSnapshot = JSON.parse(JSON.stringify(prev))
    next.general_call = '06:30'; next.location = 'Studio'
    next.scenes[1].heading = 'EXT. HARBOUR - DAWN'; next.scenes.shift()
    next.cast[0].call = '07:30'; next.crew[1].people[0].call = '06:00'; next.crew.shift()
    const d = diffSnapshots(prev, next)
    expect([...d.changed].sort()).toEqual(['cast:c1', 'crew:k1', 'general_call', 'location', 'scene:b'])
    expect(d.removed.scenes).toEqual(['1 INT. KITCHEN - DAY'])
    expect(d.removed.crew).toEqual(['Lee'])
  })
})
