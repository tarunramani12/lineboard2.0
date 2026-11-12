import { useEffect, useId, useState, type ReactNode, type InputHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { justDragged } from '../lib/dragGate'

// ---- Icons: inline strokes, never alone without a word or an accessible label
const paths: Record<string, ReactNode> = {
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  pencil: <path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4z" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  warn: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.5" /></>,
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  cloudoff: <><path d="M8 18h9a4 4 0 0 0 1-7.9A6 6 0 0 0 7 8" /><path d="M3 3l18 18" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12l5 5 9-10" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
  s_overview: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  s_script: <><path d="M7 3h8l4 4v14H7z" /><path d="M10 12h6M10 16h6" /></>,
  s_scenes: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 11h18M7 7l-2-4M13 7l-2-4M19 7l-2-4" /></>,
  s_shots: <><rect x="3" y="7" width="13" height="11" rx="2" /><path d="M16 11l5-3v8l-5-3" /></>,
  s_storyboard: <><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><path d="M13 16.5h8" /></>,
  s_breakdown: <><path d="M4 7h3M4 12h3M4 17h3M10 7h10M10 12h10M10 17h10" /></>,
  s_cast: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5a5 5 0 0 1 4 5.5" /></>,
  s_equipment: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 14h18" /></>,
  s_props: <><path d="M5.5 13.5h13M7.5 13.5l1 6.5h7l1-6.5" /><path d="M12 13.5V9" /><path d="M12 11.5c-3.4 0-5-1.4-5-4.2 3.4 0 5 1.4 5 4.2z" /><path d="M12 9c0-2.6 1.6-4.2 5-4.2 0 2.8-1.6 4.2-5 4.2z" /></>,
  s_schedule: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  s_callsheets: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 11h6M9 15h6" /></>,
  s_team: <><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  s_export: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
}
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="lb-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

/** The supplied logo. Light and dark files are swapped, never recoloured. Under 360px wide the mark stands alone. */
export function Wordmark({ large, onDark }: { large?: boolean; onDark?: boolean }) {
  // On the top bar: the supplied mark, then the word in the Slate type (Barlow Condensed capitals). The bar is black in light
  // mode (white mark) and white in dark mode (black mark). Under 360px wide the mark stands alone.
  if (onDark) {
    return (
      <span className="lb-brand">
        <picture>
          <source srcSet="/logo/lineboard-mark-light.svg" media="(prefers-color-scheme: dark)" />
          <img className="lb-brand-mark" src="/logo/lineboard-mark-dark.svg" alt="" />
        </picture>
        <span className="lb-brand-word">LINEBOARD</span>
      </span>
    )
  }
  return (
    <picture>
      <source srcSet="/logo/lineboard-mark-dark.svg" media="(max-width: 359px) and (prefers-color-scheme: dark)" />
      <source srcSet="/logo/lineboard-mark-light.svg" media="(max-width: 359px)" />
      <source srcSet="/logo/lineboard-logo-dark.svg" media="(prefers-color-scheme: dark)" />
      <img className={'lb-logo' + (large ? ' lb-logo--lg' : '')} src="/logo/lineboard-logo-light.svg" alt="LineBoard" />
    </picture>
  )
}

export function Field({ label, error, hint, ...input }: { label: string; error?: string | null; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="lb-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="lb-input" {...input} aria-invalid={error ? true : undefined} />
      {error ? <span className="lb-error" role="alert">{error}</span> : hint ? <span className="lb-caption">{hint}</span> : null}
    </div>
  )
}

export function Badge({ kind, children }: { kind: 'locked' | 'omitted' | 'revised' | 'stale' | 'conflict' | 'plain'; children: ReactNode }) {
  return (
    <span className={'lb-badge' + (kind === 'plain' ? '' : ' lb-badge--' + kind)}>
      {kind === 'locked' && <Icon name="lock" />}
      {kind === 'stale' && <Icon name="warn" />}
      {kind === 'conflict' && <Icon name="cross" />}
      {children}
    </span>
  )
}

/** A scene number in a chip. Before the script is locked a scene has no number, so the chip shows its position in a dashed outline. */
export function SceneChip({ n, position, omitted, onInk }: { n: string | null; position?: number; omitted?: boolean; onInk?: boolean }) {
  if (n === null || n === '') {
    return <span className={'lb-scene lb-scene--draft' + (onInk ? ' lb-scene--draft-on-ink' : '')} title="Not numbered until the script is locked">{position ?? ''}</span>
  }
  return <span className={'lb-scene' + (omitted ? ' lb-scene--omitted' : '') + (onInk ? ' lb-scene--on-ink' : '')}>{n}</span>
}

const SWIPE_W = 92
/**
 * A list row you can swipe left to delete. Swiping (touch or pen) or a sideways two-finger scroll on a trackpad slides the row
 * and shows a red Delete button. Pressing it asks first, then deletes. A tap anywhere else closes it.
 * `onDelete` does the deleting and throws on failure; `onRequest` lets the page show its own confirmation instead.
 */
export function SwipeRow({ children, label, canDelete = true, onDelete, onRequest, confirmText, verb = 'Delete' }: {
  children: ReactNode; label: string; canDelete?: boolean; onDelete?: () => Promise<void>; onRequest?: () => void; confirmText?: string
  verb?: 'Delete' | 'Omit' | 'Restore'   // Omit and Restore are reversible, so they show a dark button and do not ask first
}) {
  const id = useId()
  const [x, setX] = useState(0)
  const [drag, setDrag] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = useState({ x: 0, y: 0, base: 0, mode: '' as '' | 'h' | 'v', moved: false })[0]
  const open = x <= -SWIPE_W / 2

  useEffect(() => {
    const close = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) setX(0) }
    window.addEventListener('lb-swipe-open', close)
    return () => window.removeEventListener('lb-swipe-open', close)
  }, [id])
  const reveal = (v: number) => { setX(v); if (v < 0) window.dispatchEvent(new CustomEvent('lb-swipe-open', { detail: id })) }
  if (!canDelete) return <>{children}</>

  const down = (e: React.PointerEvent) => {
    const hit = (e.target as HTMLElement).closest('button, select, input, textarea, a, label')
    if (e.pointerType === 'mouse' || (hit && !hit.hasAttribute('data-swipe'))) return
    start.x = e.clientX; start.y = e.clientY; start.base = x; start.mode = ''; start.moved = false
  }
  const move = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || (start.x === 0 && start.y === 0)) return
    const dx = e.clientX - start.x, dy = e.clientY - start.y
    if (!start.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      start.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      if (start.mode === 'h') { setDrag(true); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* not an active pointer */ } }
    }
    if (start.mode !== 'h') return
    start.moved = true
    setX(Math.max(-SWIPE_W - 24, Math.min(0, start.base + dx)))
  }
  const up = () => {
    if (start.mode === 'h') { setDrag(false); reveal(x <= -SWIPE_W / 2 ? -SWIPE_W : 0) }
    start.x = 0; start.y = 0; start.mode = ''
  }
  const wheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) < 30 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return
    reveal(e.deltaX > 0 ? -SWIPE_W : 0)
  }
  const swallow = (e: React.MouseEvent) => {
    if (start.moved) { e.stopPropagation(); e.preventDefault(); start.moved = false; return }
    if (open && !(e.target as HTMLElement).closest('.lb-swipe-act')) { e.stopPropagation(); e.preventDefault(); setX(0) }
  }
  async function go() {
    setBusy(true); setError(null)
    try { await onDelete?.(); setConfirm(false); setX(0) } catch (e) { setError(e instanceof Error ? e.message : 'That could not be deleted.') } finally { setBusy(false) }
  }
  return (
    <div className="lb-swipe">
      <div className="lb-swipe-act" style={{ width: SWIPE_W, visibility: x === 0 ? 'hidden' : 'visible' }}>
        <button type="button" className={'lb-swipe-btn' + (verb === 'Delete' ? '' : ' lb-swipe-btn--ink')} tabIndex={open ? 0 : -1} aria-hidden={!open} aria-label={`${verb} ${label}`}
          onClick={() => { if (onRequest) { onRequest(); setX(0) } else setConfirm(true) }}>
          {verb === 'Delete'
            ? <svg className="lb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
            : <svg className="lb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>}
          <span>{verb}</span>
        </button>
      </div>
      <div className={'lb-swipe-body' + (drag ? ' is-dragging' : '')} style={{ transform: `translateX(${x}px)` }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} onClickCapture={swallow}>
        {children}
      </div>
      {confirm && createPortal(
        <Dialog title={`Delete ${label}?`} onClose={() => { if (!busy) { setConfirm(false); setError(null) } }}>
          <p>{confirmText ?? 'This cannot be undone.'}</p>
          {error && <p className="lb-error" role="alert">{error}</p>}
          <div className="lb-actions">
            <button type="button" className="lb-btn" disabled={busy} onClick={() => { setConfirm(false); setError(null); setX(0) }}>Keep it</button>
            <button type="button" className="lb-btn lb-btn--danger" disabled={busy} onClick={() => void go()}>{busy ? 'Deleting' : 'Delete'}</button>
          </div>
        </Dialog>, document.body)}
    </div>
  )
}

/**
 * Makes a whole list row open its detail. Clicks on the buttons, links and fields inside the row keep their own job,
 * and a click that ends a text selection does not open anything. Use with className 'is-click'.
 */
export function rowOpen(open: () => void): { onClick: (e: React.MouseEvent) => void } {
  return {
    onClick: (e) => {
      if ((e.target as HTMLElement).closest('button, a, select, input, textarea, label')) return
      if (window.getSelection()?.toString() || justDragged()) return
      open()
    },
  }
}

/**
 * Pick several people from a list. The choice is kept as comma-separated text, so the field stays a plain text column.
 * Names already in the field that are not on the list stay as they are. "Add new" lets the person type one that is not listed.
 */
export function ListPicker({ id, value, onChange, options, disabled, noun, maxLength = 500 }: {
  id: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
  disabled?: boolean; noun: string; maxLength?: number
}) {
  const chosen = value.split(',').map((x) => x.trim()).filter(Boolean)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const labelOf = (v: string) => options.find((o) => o.value.toLowerCase() === v.toLowerCase())?.label ?? v
  const join = (list: string[]) => list.join(', ').slice(0, maxLength)
  const add = (v: string) => { const t = v.replace(/,/g, ' ').trim(); if (t && !chosen.some((c) => c.toLowerCase() === t.toLowerCase())) onChange(join([...chosen, t])) }
  const free = options.filter((o) => !chosen.some((c) => c.toLowerCase() === o.value.toLowerCase()))
  return (
    <span className="lb-stack" style={{ gap: 6 }}>
      {chosen.length > 0 && (
        <span className="lb-row" style={{ gap: 6 }} role="list" aria-label={`Chosen ${noun}`}>
          {chosen.map((c) => (
            <span key={c} className="lb-chipx" role="listitem">{labelOf(c)}
              {!disabled && <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Remove ${labelOf(c)}`} onClick={() => onChange(join(chosen.filter((x) => x !== c)))}><Icon name="cross" /></button>}
            </span>
          ))}
        </span>
      )}
      {!disabled && (adding ? (
        <span className="lb-row lb-choice-add">
          <input id={id} className="lb-input" autoFocus value={text} maxLength={120} placeholder={`New ${noun}`} aria-label={`New ${noun}`} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); setAdding(false); setText('') } else if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setText('') } }} />
          <button type="button" className="lb-btn lb-btn--sm" disabled={!text.trim()} onClick={() => { add(text); setAdding(false); setText('') }}>Use</button>
          <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => { setAdding(false); setText('') }}>Cancel</button>
        </span>
      ) : (
        <select id={id} className="lb-input" value="" onChange={(e) => { if (e.target.value === '__lb_add_new__') setAdding(true); else if (e.target.value) add(e.target.value) }}>
          <option value="">{chosen.length ? `Add another ${noun}…` : `Choose ${noun}…`}</option>
          {free.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="__lb_add_new__">Add new…</option>
        </select>
      ))}
      {disabled && chosen.length === 0 && <span className="lb-input lb-input--ro">Not set</span>}
    </span>
  )
}

/** Says what you can do here and, when you cannot, who can. */
export function Permission({ level, team, why, small }: { level: 'edit' | 'view' | 'locked'; team?: string; why?: string; small?: boolean }) {
  const cls = 'lb-perm' + (level === 'locked' ? ' lb-perm--locked' : '') + (small ? ' lb-perm--sm' : '')
  return (
    <span className={cls}>
      <Icon name={level === 'edit' ? 'pencil' : level === 'view' ? 'eye' : 'lock'} />
      {level === 'edit' ? `You can edit${team ? ' · ' + team : ''}` : level === 'view' ? 'View only' : why || 'Locked'}
    </span>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="lb-empty">
      <div><strong>{title}</strong>{children}</div>
      {action}
    </div>
  )
}

export function Banner({ kind, lead, children, action }: { kind?: 'alert' | 'quiet'; lead: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={'lb-banner' + (kind ? ' lb-banner--' + kind : '')} role={kind === 'alert' ? 'alert' : 'status'}>
      <span>{kind === 'quiet' && <Icon name="cloudoff" />} <b>{lead}</b> {children}</span>
      {action}
    </div>
  )
}

export function Dialog({ title, children, onClose, sheet, badge, wide }: { title: string; children: ReactNode; onClose: () => void; sheet?: boolean; badge?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={'lb-scrim' + (sheet ? ' lb-sheet' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'lb-dialog' + (wide ? ' lb-dialog--wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        {badge}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** Run an async action with a busy flag and a plain-language error. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run<T>(fn: () => Promise<T>, friendly: (e: unknown) => string): Promise<T | undefined> {
    setBusy(true); setError(null)
    try { return await fn() }
    catch (e) { setError(friendly(e)); return undefined }
    finally { setBusy(false) }
  }
  return { busy, error, setError, run }
}

/** Online status for the quiet offline banner. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

/** A dropdown with ready-made choices and an "Add new" entry, so the list grows with the project. */
export function Choice({ id, value, onChange, options, disabled, maxLength = 60, noun = 'value' }: {
  id: string; value: string; onChange: (v: string) => void; options: string[]
  disabled?: boolean; maxLength?: number; noun?: string
}) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const list = value && !options.includes(value) ? [...options, value] : options
  const commit = () => {
    const v = text.trim()
    if (v) onChange(v)
    setAdding(false); setText('')
  }
  if (adding) {
    return (
      <span className="lb-row lb-choice-add">
        <input id={id} className="lb-input" autoFocus value={text} maxLength={maxLength} placeholder={`New ${noun}`} aria-label={`New ${noun}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setText('') } }} />
        <button type="button" className="lb-btn lb-btn--sm" disabled={!text.trim()} onClick={commit}>Use</button>
        <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => { setAdding(false); setText('') }}>Cancel</button>
      </span>
    )
  }
  return (
    <select id={id} className="lb-input" value={value} disabled={disabled} onChange={(e) => { if (e.target.value === '__lb_add_new__') setAdding(true); else onChange(e.target.value) }}>
      <option value="">Not set</option>
      {list.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={'__lb_add_new__'}>Add new…</option>
    </select>
  )
}
