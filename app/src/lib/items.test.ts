import { describe, expect, it } from 'vitest'
import { suggestFromBreakdown } from './items'
import type { BItem } from './breakdown'

const mkItem = (over: Partial<BItem>): BItem => ({ id: Math.random().toString(), project_id: 'p', scene_id: 's1', team_id: 't1', category: 'props', name: 'Teapot', quantity: 1, notes: '', ref_team_id: null, created_by: null, updated_by: null, created_at: '', updated_at: '', ...over })

describe('suggestFromBreakdown', () => {
  it('suggests each name once with the largest quantity and every scene', () => {
    const r = suggestFromBreakdown([mkItem({ scene_id: 's1', quantity: 1 }), mkItem({ scene_id: 's2', quantity: 3, name: 'teapot' })], 'props', new Set(['s1', 's2']), [])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: 'Teapot', quantity: 3, sceneIds: ['s1', 's2'] })
  })
  it('only looks at scenes in the schedule and at the right category', () => {
    const r = suggestFromBreakdown([mkItem({ scene_id: 's9' }), mkItem({ category: 'equipment', name: 'Dolly' }), mkItem({ name: 'Cup' })], 'props', new Set(['s1']), [])
    expect(r.map((x) => x.name)).toEqual(['Cup'])
  })
  it('skips what is already listed, ignoring case, and zero quantities', () => {
    const r = suggestFromBreakdown([mkItem({ name: 'Teapot' }), mkItem({ name: 'Cup', quantity: 0 }), mkItem({ name: 'Lamp' })], 'props', new Set(['s1']), [' teapot '])
    expect(r.map((x) => x.name)).toEqual(['Lamp'])
  })
})
