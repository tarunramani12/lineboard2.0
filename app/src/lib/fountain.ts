// Fountain, the plain-text screenplay format, turned into typed elements and back.
// A scene's heading is kept separate (it lives on the scene record), so this reads only the body.

export type ElementKind = 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition'
/** rev: the revision that last changed this line (set by the database after the script is locked). */
export interface Element { kind: ElementKind; text: string; rev?: number }

export const ELEMENT_LABELS: Record<ElementKind, string> = {
  action: 'Action', character: 'Character', dialogue: 'Dialogue', parenthetical: 'Parenthetical', transition: 'Transition',
}

const SCENE_START = /^(\.(?!\.)|(int|ext|est|int\.?\/ext|i\/e)[. ])/i

/** Does this line start a new scene? Used to warn the writer that a second heading is inside one scene. */
export function looksLikeHeading(line: string): boolean {
  return SCENE_START.test(line.trim())
}

function isUpper(s: string): boolean {
  return /[A-Z]/.test(s) && s === s.toUpperCase()
}
/** A character cue is all capitals, optionally followed by an extension such as (V.O.). */
function isCue(line: string): boolean {
  const t = line.trim()
  if (t.startsWith('@')) return t.length > 1
  return isUpper(t.replace(/\s*\(.*\)\s*\^?$/, '')) && !/[a-z]/.test(t.replace(/\(.*\)/, ''))
}
function isTransition(line: string): boolean {
  const t = line.trim()
  return (t.startsWith('>') && !t.endsWith('<')) || (isUpper(t) && /TO:$/.test(t))
}

export function parseFountain(text: string): Element[] {
  const out: Element[] = []
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  for (const raw of blocks) {
    const lines = raw.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, a) => l.length || (i > 0 && i < a.length - 1))
    if (!lines.length || lines.every((l) => !l.trim())) continue
    const first = lines[0]
    if (lines.length === 1 && isTransition(first)) {
      out.push({ kind: 'transition', text: first.trim().replace(/^>\s*/, '') })
    } else if (lines.length >= 2 && !first.trim().startsWith('!') && isCue(first)) {
      out.push({ kind: 'character', text: first.trim().replace(/^@/, '').replace(/\s*\^$/, '') })
      let dlg: string[] = []
      const flush = () => { if (dlg.length) { out.push({ kind: 'dialogue', text: dlg.join('\n') }); dlg = [] } }
      for (const l of lines.slice(1)) {
        const t = l.trim()
        if (/^\(.*\)$/.test(t)) { flush(); out.push({ kind: 'parenthetical', text: t }) } else dlg.push(l.trim())
      }
      flush()
    } else {
      const body = lines.join('\n')
      out.push({ kind: 'action', text: body.replace(/^!/, '') })
    }
  }
  return out
}

export function toFountain(elements: Element[]): string {
  const parts: string[] = []
  let inDialogue = false
  for (const e of elements) {
    if (e.kind === 'dialogue' || e.kind === 'parenthetical') {
      parts.push((inDialogue ? '\n' : '\n\n') + e.text)
      inDialogue = true
      continue
    }
    inDialogue = false
    let t = e.text
    if (e.kind === 'character') { if (!isCue(t) || t !== t.toUpperCase()) t = '@' + t; inDialogue = true }
    else if (e.kind === 'transition') { if (!(isUpper(t) && /TO:$/.test(t))) t = '> ' + t }
    else {
      const firstLine = t.split('\n')[0]
      const multi = t.includes('\n')
      if (/^[!@>.~=#]/.test(t) || (multi && isCue(firstLine)) || (!multi && isTransition(t))) t = '!' + t
    }
    parts.push('\n\n' + t)
  }
  return parts.join('').replace(/^\n+/, '')
}

/** A rough page count: about 55 lines to a page in standard screenplay layout. */
export function estimateLines(heading: string, elements: Element[]): number {
  const wrap = (s: string, w: number) => s.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / w)), 0)
  let lines = heading ? 2 : 0
  for (const e of elements) {
    if (e.kind === 'action') lines += wrap(e.text, 60) + 1
    else if (e.kind === 'character') lines += 1
    else if (e.kind === 'parenthetical') lines += 1
    else if (e.kind === 'dialogue') lines += wrap(e.text, 35) + 1
    else lines += 2
  }
  return lines
}
export const LINES_PER_PAGE = 55
