// Reading a script from a PDF or a Word file, in the browser. Both are turned into classified lines
// (scene heading, action, character, dialogue, parenthetical, transition) and then into Fountain text,
// which the existing reader already understands. Nothing leaves the device.
import { parseFountainScript, splitNumber, type ImportResult } from './importScript'

export type LineKind = 'heading' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition'
export interface DocLine { kind: LineKind; text: string; newPara: boolean; number?: string | null }

const HEADING = /^\s*(int|ext|est|int\.?\/ext|i\/e)[. ]/i

/** Join classified lines into Fountain text: one block per element, wrapped lines folded back together. */
export function linesToFountain(lines: DocLine[]): string {
  const out: string[] = []
  let prev: LineKind | null = null
  for (const l of lines) {
    const t = l.text.replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (l.kind === 'heading') {
      out.push('', (HEADING.test(t) ? '' : '.') + t + (l.number ? ` #${l.number}#` : ''))
    } else if (l.kind === 'character') {
      out.push('', t === t.toUpperCase() ? t : '@' + t)
    } else if (l.kind === 'dialogue') {
      if ((prev === 'character' || prev === 'parenthetical') || (prev === 'dialogue' && !l.newPara)) {
        if (prev === 'dialogue') out[out.length - 1] += ' ' + t; else out.push(t)
      } else out.push('', '@UNKNOWN', t)
    } else if (l.kind === 'parenthetical') {
      if (prev === 'parenthetical' && !l.newPara && !t.startsWith('(')) out[out.length - 1] += ' ' + t
      else if (prev === 'character' || prev === 'dialogue') out.push(t.startsWith('(') ? t : `(${t})`)
      else out.push('', '(' + t.replace(/^\(|\)$/g, '') + ')')
    } else if (l.kind === 'transition') {
      out.push('', '> ' + t)
    } else {
      if (prev === 'action' && !l.newPara) out[out.length - 1] += ' ' + t
      else out.push('', t)
    }
    prev = l.kind
  }
  return out.join('\n').replace(/^\n+/, '') + '\n'
}

/** Page furniture that is not script: page numbers, MORE, CONTINUED. */
const FURNITURE = /^(\(?\s*(more|continued|cont'?d?)\s*\)?:?|\d+\.?|continued:?\s*\(?\d*\)?|\(continued\))$/i

// ---- PDF -------------------------------------------------------------------------------------

export interface PdfItem { str: string; x: number; y: number; w: number }
export interface PdfLine { items: PdfItem[]; y: number }

/** Bring text items on the same baseline together, left to right, top to bottom. */
export function groupLines(items: PdfItem[]): PdfLine[] {
  const rows: PdfLine[] = []
  for (const it of [...items].filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < 2.5)
    if (row) row.items.push(it); else rows.push({ items: [it], y: it.y })
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x)
  return rows
}

const NUMTOKEN = /^\d+[A-Z]{0,2}\.?$/

/** One page of lines to classified script lines. baseLeft is the action margin of the whole document. */
export function classifyPage(rows: PdfLine[], baseLeft: number, pageTop: number): DocLine[] {
  const out: DocLine[] = []
  let lastY: number | null = null
  const dys: number[] = []
  for (let i = 1; i < rows.length; i++) dys.push(rows[i - 1].y - rows[i].y)
  const med = dys.length ? [...dys].sort((a, b) => a - b)[Math.floor(dys.length / 2)] : 12
  for (const row of rows) {
    if (pageTop - row.y < 62) continue            // running header and page number
    let items = row.items
    let number: string | null = null
    // scene numbers sit in the margins, apart from the text
    if (items.length >= 2 && NUMTOKEN.test(items[0].str.trim()) && items[1].x - (items[0].x + items[0].w) > 4) { number = items[0].str.trim().replace(/\.$/, ''); items = items.slice(1) }
    if (items.length >= 2 && NUMTOKEN.test(items[items.length - 1].str.trim()) && items[items.length - 1].x - (items[items.length - 2].x + items[items.length - 2].w) > 4) items = items.slice(0, -1)
    items = items.filter((i) => i.str.trim() !== '*' || items.length === 1)
    if (items.length && items[items.length - 1].str.trim() === '*') items = items.slice(0, -1)
    if (!items.length) continue
    let text = ''
    for (let k = 0; k < items.length; k++) {
      const it = items[k], p = items[k - 1]
      if (p && it.x - (p.x + p.w) > 1.5 && !/\s$/.test(p.str) && !/^\s/.test(it.str)) text += ' '
      text += it.str
    }
    text = text.replace(/\s+/g, ' ').trim()
    if (!text || FURNITURE.test(text)) continue
    const dx = items[0].x - baseLeft
    let kind: LineKind
    if (dx < 30) kind = HEADING.test(text) || number ? 'heading' : 'action'
    else if (dx < 95) kind = 'dialogue'
    else if (dx < 135) kind = 'parenthetical'
    else if (dx < 230) kind = 'character'
    else kind = 'transition'
    if (kind === 'heading' && !HEADING.test(text) && !number) kind = 'action'
    const gap = lastY !== null && lastY - row.y > med * 1.6
    out.push({ kind, text, newPara: gap || lastY === null, number: kind === 'heading' ? number : null })
    lastY = row.y
  }
  return out
}

/** The left edge most lines start at: the smallest x used by a fair share of the lines. */
export function actionLeft(pages: PdfLine[][]): number {
  const buckets = new Map<number, number>()
  let n = 0
  for (const rows of pages) for (const r of rows) {
    let items = r.items
    if (items.length >= 2 && NUMTOKEN.test(items[0].str.trim()) && items[1].x - (items[0].x + items[0].w) > 4) items = items.slice(1)
    if (!items.length) continue
    const k = Math.round(items[0].x / 3) * 3
    buckets.set(k, (buckets.get(k) ?? 0) + 1); n++
  }
  const need = Math.max(3, n * 0.05)
  return [...buckets].filter(([, c]) => c >= need).map(([k]) => k).sort((a, b) => a - b)[0] ?? 0
}

export async function readPdf(buffer: ArrayBuffer): Promise<ImportResult> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  const pages: { rows: PdfLine[]; top: number }[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const items: PdfItem[] = []
    for (const it of tc.items) {
      if (!('str' in it)) continue
      const tr = it.transform as number[]
      items.push({ str: it.str, x: tr[4], y: tr[5], w: it.width })
    }
    pages.push({ rows: groupLines(items), top: page.view[3] })
  }
  const total = pages.reduce((n, p) => n + p.rows.length, 0)
  if (total === 0) {
    const r = parseFountainScript('', 'pdf')
    r.notes = ['This PDF has no text in it. It looks like a scan or a photo of pages, which cannot be read here. Export a text PDF, Final Draft or Fountain file instead.']
    return r
  }
  const base = actionLeft(pages.map((p) => p.rows))
  const lines = pages.flatMap((p) => classifyPage(p.rows, base, p.top))
  const r = parseFountainScript(linesToFountain(lines), 'pdf')
  r.notes.unshift('Read from a PDF by the position of each line on the page. Check scene headings, speakers and dialogue before you confirm.')
  return r
}

// ---- Word (.docx) ----------------------------------------------------------------------------

const decodeXml = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const STYLE_KIND: Record<string, LineKind> = {
  sceneheading: 'heading', heading1: 'heading', heading2: 'heading', slugline: 'heading', action: 'action', general: 'action', shot: 'action', normal: 'action',
  character: 'character', dialogue: 'dialogue', parenthetical: 'parenthetical', transition: 'transition',
}

export interface DocxPara { text: string; style: string; leftPt: number; right: boolean }

export function docxParagraphs(xml: string): DocxPara[] {
  const out: DocxPara[] = []
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0]
    const style = (p.match(/<w:pStyle[^>]*w:val="([^"]*)"/)?.[1] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const left = Number(p.match(/<w:ind[^>]*w:(?:left|start)="(\d+)"/)?.[1] ?? 0) / 20
    const right = /<w:jc[^>]*w:val="right"/.test(p)
    let text = ''
    for (const t of p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) text += t[1] !== undefined ? decodeXml(t[1]) : t[0] === '<w:br/>' ? '\n' : ' '
    out.push({ text, style, leftPt: left, right })
  }
  return out
}

export function docxToFountain(paras: DocxPara[]): { text: string; styled: boolean } {
  const styled = paras.some((p) => STYLE_KIND[p.style] && p.style !== 'normal') || paras.some((p) => p.leftPt >= 30)
  if (!styled) return { text: paras.map((p) => p.text).join('\n'), styled: false }
  const lines: DocLine[] = []
  let blank = true
  for (const p of paras) {
    const t = p.text.replace(/\s+/g, ' ').trim()
    if (!t) { blank = true; continue }
    let kind: LineKind | undefined = STYLE_KIND[p.style]
    if (!kind || p.style === 'normal') {
      const dx = p.leftPt
      kind = p.right ? 'transition' : dx < 30 ? 'action' : dx < 95 ? 'dialogue' : dx < 135 ? 'parenthetical' : dx < 230 ? 'character' : 'transition'
    }
    if (kind === 'action' && HEADING.test(t)) kind = 'heading'
    const { text, number } = kind === 'heading' ? splitNumber(t) : { text: t, number: null }
    lines.push({ kind, text, number, newPara: blank })
    blank = false
  }
  return { text: linesToFountain(lines), styled: true }
}

export async function readDocx(buffer: ArrayBuffer): Promise<ImportResult> {
  const { unzipSync, strFromU8 } = await import('fflate')
  let files: Record<string, Uint8Array>
  try { files = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'word/document.xml' }) } catch { throw new Error('This file could not be opened as a Word document.') }
  const doc = files['word/document.xml']
  if (!doc) throw new Error('This file does not look like a Word (.docx) document. Older .doc files are not supported: save it as .docx first.')
  const { text, styled } = docxToFountain(docxParagraphs(strFromU8(doc)))
  const r = parseFountainScript(text, 'docx')
  r.notes.unshift(styled ? 'Read from a Word file using its paragraph styles and indents. Check scene headings, speakers and dialogue before you confirm.' : 'Read from a Word file as plain text. Check scene headings, speakers and dialogue before you confirm.')
  return r
}
