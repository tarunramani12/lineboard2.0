import { describe, expect, it } from 'vitest'
import { actionLeft, classifyPage, docxParagraphs, docxToFountain, groupLines, linesToFountain, type PdfItem } from './importDocs'
import { parseFountainScript } from './importScript'

const item = (str: string, x: number, y: number): PdfItem => ({ str, x, y, w: str.length * 7.2 })

describe('PDF layout', () => {
  // an exported page: action at 108, dialogue +72, parenthetical +115, character +158, transition right aligned
  const items: PdfItem[] = [
    item('MY FILM  -  DRAFT', 108, 760),                       // running header
    item('1', 92, 700), item('INT. KITCHEN - NIGHT', 108, 700), item('1', 546, 700),
    item('Rain on the window. Anna', 108, 676), item('stands very still.', 108, 664),
    item('ANNA', 266, 640), item('(whispering)', 223, 628), item('Not yet.', 180, 616), item('Not ever.', 180, 604),
    item('CUT TO:', 489, 580),
    item('2', 92, 556), item('EXT. STREET - DAY', 108, 556), item('2', 546, 556),
    item('A car passes.', 108, 532),
  ]
  const rows = groupLines(items)
  it('finds the action margin', () => expect(actionLeft([rows])).toBe(108))
  it('classifies lines by where they start', () => {
    const lines = classifyPage(rows, 108, 792)
    expect(lines.map((l) => l.kind)).toEqual(['heading', 'action', 'action', 'character', 'parenthetical', 'dialogue', 'dialogue', 'transition', 'heading', 'action'])
    expect(lines[0].number).toBe('1')
    expect(lines.some((l) => /DRAFT/.test(l.text))).toBe(false)
  })
  it('turns that into scenes with numbers, dialogue and a transition', () => {
    const r = parseFountainScript(linesToFountain(classifyPage(rows, 108, 792)), 'pdf')
    expect(r.scenes.map((s) => [s.number, s.heading])).toEqual([['1', 'INT. KITCHEN - NIGHT'], ['2', 'EXT. STREET - DAY']])
    const els = r.scenes[0].elements
    expect(els.map((e) => e.kind)).toEqual(['action', 'character', 'parenthetical', 'dialogue', 'transition'])
    expect(els[0].text).toBe('Rain on the window. Anna stands very still.')
    expect(els[3].text).toBe('Not yet. Not ever.')
  })
})

const docx = (paras: string[]) => `<w:document><w:body>${paras.join('')}</w:body></w:document>`
const para = (text: string, style = '', left = 0) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${left ? `<w:ind w:left="${left}"/>` : ''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`

describe('Word files', () => {
  it('uses paragraph styles', () => {
    const { text, styled } = docxToFountain(docxParagraphs(docx([
      para('INT. KITCHEN - NIGHT', 'SceneHeading'), para('Rain.', 'Action'), para('ANNA', 'Character'), para('Not yet.', 'Dialogue'), para('CUT TO:', 'Transition'),
    ])))
    expect(styled).toBe(true)
    const r = parseFountainScript(text, 'docx')
    expect(r.scenes).toHaveLength(1)
    expect(r.scenes[0].elements.map((e) => e.kind)).toEqual(['action', 'character', 'dialogue', 'transition'])
  })
  it('falls back to indents when there are no styles', () => {
    const { text, styled } = docxToFountain(docxParagraphs(docx([
      para('EXT. STREET - DAY'), para('A car passes.'), para('BOB', '', 3160), para('Hey.', '', 1440),
    ])))
    expect(styled).toBe(true)
    const r = parseFountainScript(text, 'docx')
    expect(r.scenes[0].elements.map((e) => e.kind)).toEqual(['action', 'character', 'dialogue'])
  })
  it('reads an unstyled document as plain text', () => {
    const { text, styled } = docxToFountain(docxParagraphs(docx([para('INT. HALL - DAY'), para(''), para('Quiet.'), para(''), para('MIA'), para('Hello.')])))
    expect(styled).toBe(false)
    const r = parseFountainScript(text, 'docx')
    expect(r.scenes[0].elements.map((e) => e.kind)).toEqual(['action', 'character', 'dialogue'])
  })
})
