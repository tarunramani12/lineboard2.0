import { describe, expect, it } from 'vitest'
import { estimateLines, looksLikeHeading, parseFountain, toFountain } from './fountain'

describe('parseFountain', () => {
  it('reads action, character, parenthetical, dialogue and transition', () => {
    const els = parseFountain(`Rain on the window.\nShe waits.\n\nANNA\n(quietly)\nNot yet.\nGo on.\n\nCUT TO:\n\nHe leaves.`)
    expect(els).toEqual([
      { kind: 'action', text: 'Rain on the window.\nShe waits.' },
      { kind: 'character', text: 'ANNA' },
      { kind: 'parenthetical', text: '(quietly)' },
      { kind: 'dialogue', text: 'Not yet.\nGo on.' },
      { kind: 'transition', text: 'CUT TO:' },
      { kind: 'action', text: 'He leaves.' },
    ])
  })
  it('keeps extensions on a character cue', () => {
    expect(parseFountain('ANNA (V.O.)\nHello.')[0]).toEqual({ kind: 'character', text: 'ANNA (V.O.)' })
  })
  it('treats an all-caps single line as action, not a character', () => {
    expect(parseFountain('THE END')).toEqual([{ kind: 'action', text: 'THE END' }])
  })
  it('honours forced elements', () => {
    expect(parseFountain('@McBride\nHello.')).toEqual([{ kind: 'character', text: 'McBride' }, { kind: 'dialogue', text: 'Hello.' }])
    expect(parseFountain('!SMASH\nCUT.')).toEqual([{ kind: 'action', text: 'SMASH\nCUT.' }])
    expect(parseFountain('> FADE OUT.')).toEqual([{ kind: 'transition', text: 'FADE OUT.' }])
  })
  it('ignores blank input and Windows line endings', () => {
    expect(parseFountain('  \n\n ')).toEqual([])
    expect(parseFountain('A\r\n\r\nB')).toHaveLength(2)
  })
})

describe('toFountain', () => {
  const samples = [
    [{ kind: 'action', text: 'Rain.' }, { kind: 'character', text: 'ANNA' }, { kind: 'parenthetical', text: '(quietly)' }, { kind: 'dialogue', text: 'Not yet.' }, { kind: 'transition', text: 'CUT TO:' }],
    [{ kind: 'character', text: 'McBride' }, { kind: 'dialogue', text: 'Hello.' }],
    [{ kind: 'action', text: 'SMASH\nCUT.' }],
    [{ kind: 'action', text: '.Not a heading' }, { kind: 'transition', text: 'FADE OUT.' }],
  ] as const
  it('round-trips', () => {
    for (const s of samples) expect(parseFountain(toFountain([...s]))).toEqual(s)
  })
})

describe('helpers', () => {
  it('spots scene headings', () => {
    expect(looksLikeHeading('INT. KITCHEN - DAY')).toBe(true)
    expect(looksLikeHeading('ext. street - night')).toBe(true)
    expect(looksLikeHeading('.FLASHBACK')).toBe(true)
    expect(looksLikeHeading('Interior design is hard.')).toBe(false)
  })
  it('counts lines', () => {
    expect(estimateLines('INT. A - DAY', [{ kind: 'action', text: 'x' }])).toBe(4)
  })
})
