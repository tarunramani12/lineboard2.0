import { describe, expect, it } from 'vitest'
import { countByCategory, detectCast, usedNames, type BItem } from './breakdown'

describe('detectCast', () => {
  it('lists speakers once, without extensions', () => {
    const els = [
      { kind: 'character' as const, text: 'ANNA' }, { kind: 'dialogue' as const, text: 'Hi.' },
      { kind: 'character' as const, text: 'BOB (V.O.)' }, { kind: 'character' as const, text: 'ANNA (CONT\'D)' },
      { kind: 'action' as const, text: 'CARL waves.' }, { kind: 'character' as const, text: 'MARY-ANN' },
    ]
    expect(detectCast(els)).toEqual(['Anna', 'Bob', 'Mary-Ann'])
  })
})
const it_ = (category: BItem['category'], name: string, quantity = 1, ref: string | null = null) => ({ category, name, quantity, ref_team_id: ref }) as BItem
describe('counts and names', () => {
  it('does not count equipment at quantity 0', () => {
    const c = countByCategory([it_('props', 'Kettle'), it_('equipment', 'Dolly', 0), it_('equipment', 'Jib')])
    expect(c.get('props')).toBe(1); expect(c.get('equipment')).toBe(1)
  })
  it('offers defaults then names used before', () => {
    expect(usedNames([it_('props', 'Kettle'), it_('props', 'Cup'), it_('wardrobe', 'Coat')], 'props', [])).toEqual(['Cup', 'Kettle'])
    expect(usedNames([it_('special_effects', 'Snow')], 'special_effects', ['Rain'])).toEqual(['Rain', 'Snow'])
  })
})
