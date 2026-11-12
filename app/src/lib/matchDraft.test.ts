import { describe, expect, it } from 'vitest'
import type { Element } from './fountain'
import type { ImportedScene } from './importScript'
import { autoMatch, buildPlan, defaultCut, diffElements, normalizeHeading, sameElements, type OldScene } from './matchDraft'

const A = (t: string): Element => ({ kind: 'action', text: t })
let k = 1
const neu = (heading: string, els: Element[] = [], p: Partial<ImportedScene> = {}): ImportedScene =>
  ({ key: k++, heading, number: null, omitted: false, elements: els, include: true, ...p })
const old = (id: string, number: string | null, heading: string, els: Element[] = [], status: 'active' | 'omitted' = 'active'): OldScene =>
  ({ id, number, heading, status, elements: els })

describe('autoMatch', () => {
  it('matches by number first, even when the heading changed', () => {
    const o = [old('a', '1', 'INT. KITCHEN - DAY'), old('b', '2', 'EXT. STREET - DAY')]
    const n = [neu('INT. KITCHEN - NIGHT', [], { number: '1' }), neu('EXT. STREET - DAY', [], { number: '2' })]
    const m = autoMatch(o, n)
    expect([...m.values()].map((x) => [x.oldId, x.how])).toEqual([['a', 'number'], ['b', 'number']])
  })
  it('then matches by heading, ignoring punctuation and case', () => {
    const o = [old('a', null, 'INT. Kitchen - Day'), old('b', null, 'EXT. STREET')]
    const n = [neu('EXT. STREET'), neu('int kitchen day')]
    const m = autoMatch(o, n)
    expect(m.get(n[0].key)).toEqual({ oldId: 'b', how: 'heading' })
    expect(m.get(n[1].key)).toEqual({ oldId: 'a', how: 'heading' })
  })
  it('pairs repeated headings in order', () => {
    const o = [old('a', null, 'INT. KITCHEN - DAY'), old('b', null, 'INT. KITCHEN - DAY')]
    const n = [neu('INT. KITCHEN - DAY'), neu('INT. KITCHEN - DAY')]
    const m = autoMatch(o, n)
    expect(m.get(n[0].key)!.oldId).toBe('a')
    expect(m.get(n[1].key)!.oldId).toBe('b')
  })
  it('matches a renamed heading with the same lines as similar', () => {
    const lines = [A('Rain on the window.'), A('Anna waits.'), A('A kettle ticks.')]
    const m = autoMatch([old('a', null, 'INT. SMALL KITCHEN - NIGHT', lines)], [neu('INT. APARTMENT - NIGHT', lines)])
    expect([...m.values()][0]).toEqual({ oldId: 'a', how: 'similar' })
  })
  it('leaves unrelated scenes unmatched', () => {
    const m = autoMatch([old('a', null, 'INT. KITCHEN - DAY', [A('x'), A('y')])], [neu('EXT. MOON - NIGHT', [A('p'), A('q')])])
    expect(m.size).toBe(0)
  })
  it('does not match an omitted old scene by heading', () => {
    const m = autoMatch([old('a', '3', 'INT. HALL - DAY', [], 'omitted')], [neu('INT. HALL - DAY')])
    expect(m.size).toBe(0)
  })
})

describe('diffElements', () => {
  it('marks what was added and taken out', () => {
    const d = diffElements([A('one'), A('two'), A('three')], [A('one'), A('two changed'), A('three'), A('four')])
    expect(d.map((x) => `${x.change}:${x.el.text}`)).toEqual(['same:one', 'del:two', 'add:two changed', 'same:three', 'add:four'])
  })
  it('knows when text is the same', () => {
    expect(sameElements([A('a')], [A('a')])).toBe(true)
    expect(sameElements([A('a')], [A('b')])).toBe(false)
  })
})

describe('buildPlan', () => {
  const olds = [
    old('a', '1', 'INT. ONE - DAY', [A('one')]), old('b', '2', 'INT. TWO - DAY', [A('two')]),
    old('c', '3', 'INT. THREE - DAY', [A('three')]), old('d', '3A', 'INT. OLD - DAY', [A('gone')], 'omitted'),
  ]
  it('updates matched scenes, inserts new ones in place and omits cut ones after the lock', () => {
    const n = [neu('INT. ONE - DAY', [A('one changed')]), neu('INT. BRAND NEW - DAY', [A('new')]), neu('INT. THREE - DAY', [A('three')])]
    const matches = new Map<number, string | null>([[n[0].key, 'a'], [n[1].key, null], [n[2].key, 'c']])
    const { plan, summary } = buildPlan(olds, n, matches, new Map(), true)
    expect(plan.map((p) => p.op + ':' + ('id' in p ? p.id : p.heading))).toEqual([
      'update:a', 'omit:b', 'insert:INT. BRAND NEW - DAY', 'update:c', 'keep:d',
    ])
    expect(summary).toMatchObject({ updated: 1, unchanged: 1, inserted: 1, omitted: 1, kept: 1, removed: 0 })
  })
  it('removes cut scenes when unlocked, and the owner can keep them', () => {
    const n = [neu('INT. ONE - DAY', [A('one')])]
    const matches = new Map<number, string | null>([[n[0].key, 'a']])
    const u = buildPlan(olds, n, matches, new Map(), false)
    expect(u.plan.filter((p) => p.op === 'remove').map((p) => 'id' in p && p.id)).toEqual(['b', 'c'])
    const kept = buildPlan(olds, n, matches, new Map([['b', 'keep'], ['c', 'keep']]), false)
    expect(kept.plan.map((p) => p.op)).toEqual(['update', 'keep', 'keep', 'keep'])
  })
  it('never removes after the lock, even if asked', () => {
    const n = [neu('INT. ONE - DAY', [A('one')])]
    const { plan } = buildPlan(olds, n, new Map([[n[0].key, 'a']]), new Map([['b', 'remove']]), true)
    expect(plan.some((p) => p.op === 'remove')).toBe(false)
  })
  it('keeps the number a new scene arrives with only if it is free, and only after the lock', () => {
    const n = [neu('INT. NEW A', [], { number: '4' }), neu('INT. NEW B', [], { number: '1' })]
    const matches = new Map<number, string | null>([[n[0].key, null], [n[1].key, null]])
    const l = buildPlan(olds, n, matches, new Map(), true).plan.filter((p) => p.op === 'insert')
    expect(l.map((p) => 'number' in p && p.number)).toEqual(['4', null])
    const u = buildPlan(olds, n, matches, new Map(), false).plan.filter((p) => p.op === 'insert')
    expect(u.map((p) => 'number' in p && p.number)).toEqual([null, null])
  })
  it('skips a scene the new draft marks omitted when nothing matched, omits one that matched', () => {
    const n = [neu('OMITTED', [], { omitted: true, number: '9' }), neu('OMITTED', [], { omitted: true, number: '2' })]
    const { plan } = buildPlan(olds, n, new Map([[n[0].key, null], [n[1].key, 'b']]), new Map(), true)
    expect(plan.filter((p) => p.op === 'insert')).toHaveLength(0)
    expect(plan.some((p) => p.op === 'omit' && p.id === 'b')).toBe(true)
  })
  it('defaults', () => {
    expect(defaultCut(olds[0], true)).toBe('omit')
    expect(defaultCut(olds[0], false)).toBe('remove')
    expect(defaultCut(olds[3], true)).toBe('keep')
    expect(normalizeHeading(' int.  Kitchen - Day ')).toBe('INT KITCHEN DAY')
  })
})
