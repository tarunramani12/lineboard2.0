// Taking the script back out: PDF in standard screenplay layout, Final Draft (.fdx) and Fountain.
// Everything runs in the browser, on the scenes this person is allowed to read.
import { toFountain, type Element } from './fountain'

export interface ExportScene {
  number: string | null
  heading: string
  omitted: boolean
  elements: Element[]
  revisedIn: number | null
}

// ---- Fountain ---------------------------------------------------------------------------------

export function toFountainFile(scenes: ExportScene[]): string {
  return scenes.map((s) => {
    if (s.omitted) return s.number ? `${s.number} OMITTED` : 'OMITTED'
    const head = `${s.heading || 'INT. UNTITLED - DAY'}${s.number ? ` #${s.number}#` : ''}`
    const body = toFountain(s.elements.map((e) => ({ kind: e.kind, text: e.text })))
    return body ? `${head}\n\n${body}` : head
  }).join('\n\n') + '\n'
}

// ---- Final Draft ------------------------------------------------------------------------------

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const FDX_TYPE: Record<Element['kind'], string> = {
  action: 'Action', character: 'Character', dialogue: 'Dialogue', parenthetical: 'Parenthetical', transition: 'Transition',
}

export function toFdx(scenes: ExportScene[]): string {
  const p: string[] = []
  for (const s of scenes) {
    const num = s.number ? ` Number="${esc(s.number)}"` : ''
    p.push(`    <Paragraph${num} Type="Scene Heading"><Text>${esc(s.omitted ? 'OMITTED' : s.heading)}</Text></Paragraph>`)
    if (s.omitted) continue
    for (const e of s.elements) p.push(`    <Paragraph Type="${FDX_TYPE[e.kind]}"><Text>${esc(e.text)}</Text></Paragraph>`)
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n  <Content>\n${p.join('\n')}\n  </Content>\n</FinalDraft>\n`
}

// ---- PDF layout -------------------------------------------------------------------------------
// A4, Courier 12 point: 10 characters to the inch, 6 lines to the inch. Left margin 1.5 in,
// right 1 in, top and bottom 1 in. That is a text block 60 characters wide and 54 lines tall.

export const PAGE_COLS = 60
export const PAGE_ROWS = 54
const COLS = { action: [0, 60], heading: [0, 60], character: [22, 38], parenthetical: [16, 25], dialogue: [10, 35] } as const

export interface PdfRow {
  row: number; col: number; text: string; bold?: boolean
  number?: string | null          // scene number, printed in both margins
  rev?: number | null             // revision that changed this line: an asterisk in the right margin
}
export interface PdfPage { rows: PdfRow[] }

/** Break text into lines of at most width characters, on spaces, keeping the writer's own line breaks. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word
      while (w.length > width) { if (line) { out.push(line); line = '' } out.push(w.slice(0, width)); w = w.slice(width) }
      if (!line) line = w
      else if (line.length + 1 + w.length <= width) line += ' ' + w
      else { out.push(line); line = w }
    }
    out.push(line)
  }
  return out
}

interface Block { rows: Omit<PdfRow, 'row'>[]; keepNext: number }

function blocksFor(s: ExportScene): Block[] {
  const blocks: Block[] = []
  const heading = s.omitted ? 'OMITTED' : (s.heading || 'INT. UNTITLED - DAY').toUpperCase()
  const hrows = wrapText(heading, PAGE_COLS).map((t, i) => ({ col: 0, text: t, bold: true, number: i === 0 ? s.number : null }))
  blocks.push({ rows: hrows, keepNext: 3 })
  if (s.omitted) return blocks
  const els = s.elements
  for (let i = 0; i < els.length; i++) {
    const e = els[i]
    const rev = e.rev ?? null
    if (e.kind === 'character') {
      const rows: Block['rows'] = []
      const add = (el: Element, col: number, width: number, upper = false) => {
        wrapText(upper ? el.text.toUpperCase() : el.text, width).forEach((t) => rows.push({ col, text: t, rev: el.rev ?? null }))
      }
      add(e, COLS.character[0], COLS.character[1], true)
      while (i + 1 < els.length && (els[i + 1].kind === 'dialogue' || els[i + 1].kind === 'parenthetical')) {
        const d = els[++i]
        const c = d.kind === 'dialogue' ? COLS.dialogue : COLS.parenthetical
        add(d, c[0], c[1])
      }
      blocks.push({ rows, keepNext: 0 })
    } else if (e.kind === 'transition') {
      const rows = wrapText(e.text.toUpperCase(), PAGE_COLS).map((t) => ({ col: Math.max(0, PAGE_COLS - t.length), text: t, rev }))
      blocks.push({ rows, keepNext: 0 })
    } else {
      blocks.push({ rows: wrapText(e.text, PAGE_COLS).map((t) => ({ col: 0, text: t, rev })), keepNext: 0 })
    }
  }
  return blocks
}

/** Lay the scenes out on pages. A scene heading never ends a page, and short dialogue stays together. */
export function layoutScript(scenes: ExportScene[]): PdfPage[] {
  const pages: PdfPage[] = [{ rows: [] }]
  let r = 0
  const put = (b: Omit<PdfRow, 'row'>) => { pages[pages.length - 1].rows.push({ ...b, row: r }); r++ }
  const newPage = () => { pages.push({ rows: [] }); r = 0 }
  const all = scenes.flatMap(blocksFor)
  all.forEach((b, i) => {
    const gap = r === 0 ? 0 : 1
    const next = all[i + 1]
    const need = gap + b.rows.length + (b.keepNext ? Math.min(b.keepNext, (next?.rows.length ?? 0) + 1) : 0)
    if (r > 0 && r + need > PAGE_ROWS && (b.rows.length <= PAGE_ROWS || b.keepNext)) newPage()
    if (r > 0) r += 1
    let rows = b.rows
    while (rows.length > PAGE_ROWS - r) {
      const fit = Math.max(1, PAGE_ROWS - r)
      rows.slice(0, fit).forEach(put)
      rows = rows.slice(fit)
      newPage()
    }
    rows.forEach(put)
  })
  return pages
}

export interface PdfMeta { title: string; revision: string | null }

/** Draw the pages with jsPDF. Loaded only when someone exports, so it does not weigh on the app. */
export async function buildPdf(pages: PdfPage[], meta: PdfMeta): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const CH = 7.2, LH = 12, LEFT = 108, TOP = 72
  doc.setFontSize(12)
  pages.forEach((pg, i) => {
    if (i > 0) doc.addPage()
    doc.setFont('courier', 'normal'); doc.setFontSize(9)
    doc.text(`${meta.title.toUpperCase()}${meta.revision ? '  -  ' + meta.revision.toUpperCase() + ' REVISION' : '  -  DRAFT'}`, LEFT, 40)
    if (i > 0) { doc.setFontSize(12); doc.text(`${i + 1}.`, LEFT + PAGE_COLS * CH, 54, { align: 'right' }) }
    doc.setFontSize(12)
    for (const row of pg.rows) {
      const y = TOP + (row.row + 1) * LH - 3
      doc.setFont('courier', row.bold ? 'bold' : 'normal')
      doc.text(row.text, LEFT + row.col * CH, y)
      if (row.number) {
        doc.text(row.number, LEFT - 8, y, { align: 'right' })
        doc.text(row.number, LEFT + PAGE_COLS * CH + 14, y)
      }
      if (row.rev) { doc.setFont('courier', 'normal'); doc.text('*', LEFT + (PAGE_COLS + 1) * CH, y) }
    }
  })
  return doc.output('blob')
}
