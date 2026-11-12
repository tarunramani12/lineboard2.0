// Reading a script file into scenes. Everything here runs in the browser: the file is never uploaded
// before the owner confirms on the review screen.
import { looksLikeHeading, parseFountain, type Element, type ElementKind } from './fountain'

export interface ImportedScene {
  key: number                    // stable id for the review list
  heading: string
  number: string | null          // the scene number the file carried, if any
  omitted: boolean
  elements: Element[]
  include: boolean
  fromPreamble?: boolean         // text found before the first scene heading
}
export type ImportFormat = 'fdx' | 'fountain' | 'text' | 'pdf' | 'docx'
export interface ImportResult { format: ImportFormat; scenes: ImportedScene[]; notes: string[] }

let nextKey = 1
const mk = (p: Partial<ImportedScene>): ImportedScene => ({
  key: nextKey++, heading: '', number: null, omitted: false, elements: [], include: true, ...p,
})

const STRICT_HEADING = /^\s*(int|ext|est|int\.?\/ext|i\/e)[. ]/i
const OMITTED = /^\s*#?(\d+[A-Z]*)?#?\s*[.\-:]*\s*OMITTED\s*\.?\s*$/i

/** Pull a trailing or leading scene number out of a heading: "INT. KITCHEN - DAY #42A#" or "42A  INT. ...". */
export function splitNumber(heading: string): { text: string; number: string | null } {
  let t = heading.trim()
  let number: string | null = null
  const tail = t.match(/\s#([A-Za-z0-9.\-]+)#\s*$/)
  if (tail) { number = tail[1]; t = t.slice(0, tail.index).trim() }
  return { text: t, number }
}

function omittedNumber(line: string): string | null | undefined {
  const m = line.match(OMITTED)
  if (!m) return undefined
  return m[1] ?? null
}

/** Fountain and plain text. Plain text is read as Fountain: scene headings start with INT. or EXT. */
export function parseFountainScript(raw: string, format: ImportFormat = 'fountain'): ImportResult {
  const notes: string[] = []
  let text = raw.replace(/\r\n?/g, '\n').replace(/﻿/g, '')
  text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '')

  // Fountain title page: "Title: ..." lines at the very top, ended by a blank line.
  if (/^\s*(title|credit|author|authors|source|draft date|date|contact|copyright|notes|revision)\s*:/i.test(text)) {
    const end = text.search(/\n\s*\n/)
    if (end > -1) { text = text.slice(end).replace(/^\s+/, ''); notes.push('The title page was left out.') }
  }

  const lines = text.split('\n')
  const scenes: ImportedScene[] = []
  let cur: { heading: string; number: string | null; omitted: boolean; body: string[]; pre: boolean } | null = null
  const pre: string[] = []
  const flush = () => {
    if (!cur) return
    scenes.push(mk({
      heading: cur.heading, number: cur.number, omitted: cur.omitted,
      elements: parseFountain(cur.body.join('\n')),
    }))
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    const prevBlank = i === 0 || lines[i - 1].trim() === ''
    const om = t ? omittedNumber(t) : undefined
    const forced = /^\.(?!\.)/.test(t) && prevBlank
    if (t && (STRICT_HEADING.test(t) || forced || om !== undefined)) {
      flush()
      if (om !== undefined) {
        cur = { heading: 'OMITTED', number: om, omitted: true, body: [], pre: false }
      } else {
        const { text: h, number } = splitNumber(forced ? t.slice(1) : t)
        cur = { heading: h.toUpperCase(), number, omitted: false, body: [], pre: false }
      }
      continue
    }
    if (/^\s*={3,}\s*$/.test(t)) continue                 // page break
    if (/^#+\s/.test(t) || /^=\s/.test(t)) continue       // section and synopsis lines
    if (cur) cur.body.push(line); else pre.push(line)
  }
  flush()

  const preText = pre.join('\n').trim()
  if (preText) {
    const els = parseFountain(preText)
    if (scenes.length) {
      scenes[0] = { ...scenes[0], elements: [...els, ...scenes[0].elements] }
      notes.push('Text before the first scene heading (such as FADE IN:) was added to the start of the first scene.')
    } else {
      scenes.push(mk({ heading: '', elements: els, fromPreamble: true }))
    }
  }
  if (!scenes.length) notes.push('No text was found in this file.')
  else if (scenes.length === 1 && scenes[0].fromPreamble) notes.push('No scene headings were found. Scene headings start with INT. or EXT. Check the file, or split the text into scenes below.')
  return { format, scenes, notes }
}

// ---- Final Draft (.fdx) ----------------------------------------------------------------------

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return m ? decode(m[1]) : null
}
const FDX_KIND: Record<string, ElementKind | undefined> = {
  action: 'action', general: 'action', shot: 'action', character: 'character', dialogue: 'dialogue',
  parenthetical: 'parenthetical', transition: 'transition',
}

export function parseFdx(xml: string): ImportResult {
  const notes: string[] = []
  let body = xml.replace(/<TitlePage[\s\S]*?<\/TitlePage>/i, '')
  const content = body.match(/<Content\b[^>]*>([\s\S]*?)<\/Content>/i)
  body = content ? content[1] : body
  const scenes: ImportedScene[] = []
  const pre: Element[] = []
  let cur: ImportedScene | null = null
  const re = /<Paragraph\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Paragraph>)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const type = (attr(m[1], 'Type') ?? 'Action').trim()
    const inner = m[2] ?? ''
    let text = ''
    const tre = /<Text\b[^>]*?(?:\/>|>([\s\S]*?)<\/Text>)/gi
    let tm: RegExpExecArray | null
    while ((tm = tre.exec(inner))) text += decode((tm[1] ?? '').replace(/<[^>]+>/g, ''))
    text = text.replace(/\s+$/, '')
    if (/^scene heading$/i.test(type)) {
      const om = text.trim().match(OMITTED)
      const num = (attr(m[1], 'Number') ?? '').trim()
      cur = mk({
        heading: om ? 'OMITTED' : text.trim().toUpperCase(),
        number: num || (om && om[1]) || null,
        omitted: Boolean(om),
      })
      scenes.push(cur)
      continue
    }
    const kind = FDX_KIND[type.toLowerCase()]
    if (!kind || !text.trim()) continue
    const el: Element = { kind, text: text.trim() }
    if (cur) cur.elements.push(el); else pre.push(el)
  }
  if (pre.length) {
    if (scenes.length) {
      scenes[0].elements = [...pre, ...scenes[0].elements]
      notes.push('Text before the first scene heading (such as FADE IN:) was added to the start of the first scene.')
    } else {
      scenes.push(mk({ heading: '', elements: pre, fromPreamble: true }))
    }
  }
  if (!scenes.length) notes.push('No script text was found in this Final Draft file.')
  return { format: 'fdx', scenes, notes }
}

/** Choose a reader from the file name and its first bytes. */
export function parseScriptFile(name: string, text: string): ImportResult {
  const lower = name.toLowerCase()
  if (lower.endsWith('.fdx') || /^\s*<\?xml[\s\S]{0,300}<FinalDraft/i.test(text) || /^\s*<FinalDraft/i.test(text)) return parseFdx(text)
  return parseFountainScript(text, lower.endsWith('.fountain') || lower.endsWith('.spmd') ? 'fountain' : 'text')
}

// ---- Review screen helpers --------------------------------------------------------------------

export type SceneFlag = 'noheading' | 'empty' | 'dupnumber' | 'oddheading'
export const FLAG_TEXT: Record<SceneFlag, string> = {
  noheading: 'No scene heading',
  empty: 'No text',
  dupnumber: 'Number used twice',
  oddheading: 'Check the heading',
}

export function sceneFlags(scenes: ImportedScene[]): Map<number, SceneFlag[]> {
  const counts = new Map<string, number>()
  for (const s of scenes) if (s.include && s.number) counts.set(s.number, (counts.get(s.number) ?? 0) + 1)
  const out = new Map<number, SceneFlag[]>()
  for (const s of scenes) {
    const f: SceneFlag[] = []
    if (s.include && !s.omitted) {
      if (!s.heading.trim()) f.push('noheading')
      else if (!looksLikeHeading(s.heading)) f.push('oddheading')
      if (!s.elements.length) f.push('empty')
      if (s.number && (counts.get(s.number) ?? 0) > 1) f.push('dupnumber')
    }
    out.set(s.key, f)
  }
  return out
}

/** Join scene i into the scene before it. The joined heading becomes an action line so nothing is lost. */
export function mergeIntoPrevious(scenes: ImportedScene[], i: number): ImportedScene[] {
  if (i <= 0 || i >= scenes.length) return scenes
  const prev = scenes[i - 1], s = scenes[i]
  const joined: Element[] = [...prev.elements]
  if (s.heading.trim() && !s.omitted) joined.push({ kind: 'action', text: s.heading.trim() })
  joined.push(...s.elements)
  return [...scenes.slice(0, i - 1), { ...prev, elements: joined }, ...scenes.slice(i + 1)]
}

/** Start a new scene at element index k (the first k elements stay). */
export function splitAt(scenes: ImportedScene[], i: number, k: number): ImportedScene[] {
  const s = scenes[i]
  if (!s || k <= 0 || k >= s.elements.length) return scenes
  const first = { ...s, elements: s.elements.slice(0, k) }
  const second = mk({ heading: '', number: null, elements: s.elements.slice(k) })
  return [...scenes.slice(0, i), first, second, ...scenes.slice(i + 1)]
}

export interface ImportPayloadScene { number: string | null; heading: string; omitted: boolean; elements: { kind: ElementKind; text: string }[] }

/** What goes to the database. keepNumbers = false drops numbers and leaves out omitted scenes (a plain draft). */
export function toPayload(scenes: ImportedScene[], keepNumbers: boolean): ImportPayloadScene[] {
  return scenes
    .filter((s) => s.include && (keepNumbers || !s.omitted))
    .map((s) => ({
      number: keepNumbers ? s.number : null,
      heading: s.heading.trim().toUpperCase(),
      omitted: keepNumbers && s.omitted,
      elements: s.elements.map((e) => ({ kind: e.kind, text: e.text })),
    }))
}
