import { describe, expect, it } from 'vitest'
import { PAGE_COLS, PAGE_ROWS, layoutScript, toFdx, toFountainFile, wrapText, type ExportScene } from './exportScript'
import { parseFdx, parseFountainScript } from './importScript'

const scene = (p: Partial<ExportScene> = {}): ExportScene => ({
  number: '1', heading: 'INT. KITCHEN - NIGHT', omitted: false, revisedIn: null,
  elements: [
    { kind: 'action', text: 'Rain on the window & Anna waits.' },
    { kind: 'character', text: 'ANNA' }, { kind: 'parenthetical', text: '(quietly)' }, { kind: 'dialogue', text: 'Not yet.' },
    { kind: 'transition', text: 'CUT TO:' },
  ], ...p,
})

describe('wrapText', () => {
  it('wraps on spaces and keeps the writer\'s line breaks', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four'])
    expect(wrapText('a\nb', 10)).toEqual(['a', 'b'])
  })
  it('breaks a word longer than the line', () => {
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

describe('layoutScript', () => {
  it('prints the heading in bold with the scene number, and indents character and dialogue', () => {
    const rows = layoutScript([scene()])[0].rows
    expect(rows[0]).toMatchObject({ row: 0, col: 0, bold: true, number: '1', text: 'INT. KITCHEN - NIGHT' })
    expect(rows.find((r) => r.text === 'ANNA')!.col).toBe(22)
    expect(rows.find((r) => r.text === '(quietly)')!.col).toBe(16)
    expect(rows.find((r) => r.text === 'Not yet.')!.col).toBe(10)
    const t = rows.find((r) => r.text === 'CUT TO:')!
    expect(t.col + t.text.length).toBe(PAGE_COLS)
  })
  it('leaves one blank line between blocks', () => {
    const rows = layoutScript([scene()])[0].rows
    const rowOf = (t: string) => rows.find((r) => r.text === t)!.row
    expect(rowOf('Rain on the window & Anna waits.') - rowOf('INT. KITCHEN - NIGHT')).toBe(2)
    expect(rowOf('ANNA') - rowOf('Rain on the window & Anna waits.')).toBe(2)
    expect(rowOf('(quietly)') - rowOf('ANNA')).toBe(1)
  })
  it('breaks pages at 54 lines and never ends a page on a scene heading', () => {
    const many = Array.from({ length: 60 }, (_, i) => scene({ number: String(i + 1), heading: `INT. ROOM ${i} - DAY` }))
    const pages = layoutScript(many)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) {
      expect(Math.max(...p.rows.map((r) => r.row))).toBeLessThan(PAGE_ROWS)
      const last = p.rows[p.rows.length - 1]
      expect(last.bold).not.toBe(true)
    }
  })
  it('splits one very long block across pages', () => {
    const long = scene({ elements: [{ kind: 'action', text: Array.from({ length: 200 }, (_, i) => `line${i}`).join('\n') }] })
    const pages = layoutScript([long])
    expect(pages.length).toBeGreaterThan(3)
  })
  it('marks changed lines and prints an omitted scene as OMITTED', () => {
    const s = scene({ elements: [{ kind: 'action', text: 'New line.', rev: 1 }, { kind: 'action', text: 'Old line.' }] })
    const rows = layoutScript([s, scene({ number: '2', omitted: true, elements: [] })])[0].rows
    expect(rows.find((r) => r.text === 'New line.')!.rev).toBe(1)
    expect(rows.find((r) => r.text === 'Old line.')!.rev).toBeNull()
    expect(rows.some((r) => r.text === 'OMITTED' && r.number === '2')).toBe(true)
  })
})

describe('Final Draft and Fountain export', () => {
  const scenes = [scene({ number: '1A' }), scene({ number: '2', omitted: true, elements: [] }), scene({ number: null, heading: 'EXT. STREET - DAY', elements: [{ kind: 'action', text: 'A <car> passes.' }] })]
  it('writes FDX that reads back into the same scenes', () => {
    const r = parseFdx(toFdx(scenes))
    expect(r.scenes.map((s) => [s.number, s.heading, s.omitted])).toEqual([['1A', 'INT. KITCHEN - NIGHT', false], ['2', 'OMITTED', true], [null, 'EXT. STREET - DAY', false]])
    expect(r.scenes[0].elements.map((e) => e.kind)).toEqual(['action', 'character', 'parenthetical', 'dialogue', 'transition'])
    expect(r.scenes[2].elements[0].text).toBe('A <car> passes.')
    expect(r.scenes[0].elements[0].text).toBe('Rain on the window & Anna waits.')
  })
  it('writes Fountain that reads back, numbers and omitted scenes included', () => {
    const r = parseFountainScript(toFountainFile(scenes))
    expect(r.scenes.map((s) => [s.number, s.omitted])).toEqual([['1A', false], ['2', true], [null, false]])
    expect(r.scenes[0].elements.map((e) => e.kind)).toEqual(['action', 'character', 'parenthetical', 'dialogue', 'transition'])
  })
})
