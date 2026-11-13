import { describe, expect, it } from 'vitest'
import { EMPTY_FORMAT, draftFrom, reorderIds, sameDraft } from './bible'

describe('project bible helpers', () => {
  it('moves a card earlier or later and stops at the ends', () => {
    expect(reorderIds(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(reorderIds(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(reorderIds(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(reorderIds(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(reorderIds(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b'])
  })
  it('starts from 24 frames a second and compares drafts field by field', () => {
    const d = draftFrom(null)
    expect(d).toEqual(EMPTY_FORMAT)
    expect(d.frame_rate).toBe('24')
    expect(sameDraft(d, { ...d })).toBe(true)
    expect(sameDraft(d, { ...d, notes: 'x' })).toBe(false)
  })
})
