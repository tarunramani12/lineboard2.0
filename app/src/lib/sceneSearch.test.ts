import { describe, expect, it } from 'vitest'
import { highlight, matchScene, sceneText } from './sceneSearch'

const kitchen = { number: '4', heading: 'INT. KITCHEN - NIGHT', text: 'MARA\nI never lied to you.' }

describe('matchScene', () => {
  it('matches everything when nothing is typed', () => {
    expect(matchScene('', kitchen)).toBe(true)
    expect(matchScene('   ', kitchen)).toBe(true)
  })
  it('matches the heading, ignoring capitals', () => {
    expect(matchScene('kitchen', kitchen)).toBe(true)
    expect(matchScene('NIGHT', kitchen)).toBe(true)
    expect(matchScene('garden', kitchen)).toBe(false)
  })
  it('matches a scene number and its lettered siblings, not longer numbers', () => {
    const s = (number: string) => ({ number, heading: 'INT. HALL - DAY' })
    expect(matchScene('12', s('12'))).toBe(true)
    expect(matchScene('12', s('12A'))).toBe(true)
    expect(matchScene('12', s('120'))).toBe(false)
    expect(matchScene('12a', s('12A'))).toBe(true)
    expect(matchScene('1', s('12'))).toBe(false)
  })
  it('accepts a numeric position when the scene has no number yet', () => {
    expect(matchScene('3', { number: 3, heading: '' })).toBe(true)
    expect(matchScene('3', { number: null, heading: '' })).toBe(false)
  })
  it('matches the scene text when it is given', () => {
    expect(matchScene('lied', kitchen)).toBe(true)
    expect(matchScene('mara', kitchen)).toBe(true)
  })
  it('does not see text that was left out (a scene the person may not read)', () => {
    expect(matchScene('lied', { number: '4', heading: kitchen.heading })).toBe(false)
  })
})

describe('highlight', () => {
  it('splits around every match, keeping the original capitals', () => {
    expect(highlight('INT. KITCHEN - kitchen', 'kitchen')).toEqual([
      { text: 'INT. ', hit: false }, { text: 'KITCHEN', hit: true }, { text: ' - ', hit: false }, { text: 'kitchen', hit: true },
    ])
  })
  it('returns the text whole when there is nothing to mark', () => {
    expect(highlight('INT. HALL', '')).toEqual([{ text: 'INT. HALL', hit: false }])
    expect(highlight('INT. HALL', 'zzz')).toEqual([{ text: 'INT. HALL', hit: false }])
  })
})

describe('sceneText', () => {
  it('joins the element lines', () => {
    expect(sceneText([{ kind: 'character', text: 'MARA' }, { kind: 'dialogue', text: 'Hello.' }])).toBe('MARA\nHello.')
  })
})
