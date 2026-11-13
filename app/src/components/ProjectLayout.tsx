import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useParams, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import {
  hodTeamIds, isOwnerOrAdmin, levelFor, myTeamNames, roleLabel, useBundle, type Bundle,
} from '../lib/project'
import { SECTIONS, type SectionDef } from '../lib/sections'
import { usePendingJoinRequests } from '../lib/joinRequests'
import { useAccessRequests } from '../lib/accessRequests'
import { Banner, EmptyState, Icon, Wordmark, useOnline } from './ui'

export interface Ctx { b: Bundle; pid: string; uid: string }

/** What the nav shows for a section: a tag word, or a lock. */
export function navState(b: Bundle, s: SectionDef): { locked: boolean; tag: string | null } {
  if (s.key) {
    const l = levelFor(b, s.key)
    if (s.key === 'cast_crew') return { locked: false, tag: null }   // everyone can open it: with no access they see only their own row
    return { locked: l === 'none', tag: null }   // no VIEW tag: the app does not announce what kind of access a person has
  }
  if (s.fixed === 'team') {
    if (isOwnerOrAdmin(b)) return { locked: false, tag: null }
    return hodTeamIds(b).length ? { locked: false, tag: null } : { locked: true, tag: null }
  }
  return { locked: false, tag: null }
}

/** Short names for the phone bar, where each item is narrow. */
const DOCK_NAME: Record<string, string> = { '': 'Overview', script: 'Script', shots: 'Shots', storyboard: 'Boards', bible: 'Bible', breakdown: 'Breakdown', cast: 'Cast', props: 'Props', equipment: 'Gear', schedule: 'Schedule', callsheets: 'Call sheets', team: 'Team', export: 'Settings' }

/** Phone only: one row along the bottom that swipes sideways. The current section scrolls into view. */
function SectionDock({ b, pid, pending }: { b: Bundle; pid: string; pending: number }) {
  const ref = useRef<HTMLElement>(null)
  const loc = useLocation()
  useEffect(() => {
    const cur = ref.current?.querySelector<HTMLElement>('a[aria-current="page"]')
    const bar = ref.current
    if (!cur || !bar) return
    const left = cur.offsetLeft - (bar.clientWidth - cur.offsetWidth) / 2
    bar.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [loc.pathname])
  return (
    <nav className="lb-dock" aria-label="Project sections" ref={ref}>
      {SECTIONS.filter((s) => !navState(b, s).locked).map((s) => {   // a section the person has no access to is not listed at all
        const st = navState(b, s)
        return (
          <NavLink key={s.path} to={`/p/${pid}${s.path ? '/' + s.path : ''}`} end={s.path === ''} title={s.label}
            className={st.locked ? 'is-locked' : undefined}>
            <Icon name={s.icon as never} />
            <span className="lb-dock-name" aria-hidden="true">{DOCK_NAME[s.path] ?? s.label}</span>
            <span className="lb-sr">{s.label}{st.locked ? ', no access' : st.tag ? `, ${st.tag.toLowerCase()}` : ''}</span>
            {st.locked && <span className="lb-dock-lock" aria-hidden="true"><Icon name="lock" /></span>}
            {s.fixed === 'team' && pending > 0 && <span className="lb-dock-count"><span aria-hidden="true">{pending}</span><span className="lb-sr">, {pending} {pending === 1 ? 'request' : 'requests'} waiting</span></span>}
          </NavLink>
        )
      })}
    </nav>
  )
}

function SectionNav({ b, pid, pending, onGo, hidden, onToggle }: { b: Bundle; pid: string; pending: number; onGo?: () => void; hidden?: boolean; onToggle?: () => void }) {
  return (
    <nav className="lb-nav" id="lb-sections" aria-label="Project sections">
      <div className="lb-navhead">
        {onToggle && (
          <button className="lb-iconbtn" onClick={onToggle} aria-expanded={!hidden} aria-controls="lb-sections"
            aria-label={hidden ? 'Show sections' : 'Hide sections'} title={(hidden ? 'Show sections' : 'Hide sections') + ' (Ctrl or Cmd + B)'}>
            <Icon name="panel" />
          </button>
        )}
        <div className="lb-label">{myTeamNames(b)} · {roleLabel(b)}</div>
      </div>
      {SECTIONS.filter((s) => !navState(b, s).locked).map((s) => {   // a section the person has no access to is not listed at all
        const st = navState(b, s)
        return (
          <NavLink key={s.path} to={`/p/${pid}${s.path ? '/' + s.path : ''}`} end={s.path === ''} onClick={onGo} title={s.label}
            className={st.locked ? 'is-locked' : undefined}>
            <span className="lb-navico"><Icon name={s.icon as never} /></span>
            <span className="lb-navtxt">{s.label}</span>
            <span className={'lb-tag' + (!st.locked && s.fixed === 'team' && pending > 0 ? ' lb-tag--new' : '')}>
              {st.locked ? <><Icon name="lock" /><span style={{ position: 'absolute', left: -9999 }}>No access</span></> : s.fixed === 'team' && pending > 0 ? `${pending} NEW` : st.tag}
            </span>
          </NavLink>
        )
      })}
    </nav>
  )
}

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const m = window.matchMedia(query)
    const h = () => setOn(m.matches)
    h(); m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [query])
  return on
}

export default function ProjectLayout() {
  const { pid } = useParams()
  const { user } = useAuth()
  const q = useBundle(pid, user?.id)
  const online = useOnline()
  // The section list sits at the side from 640px up. It starts as the slim icon rail on narrower screens and open on wide ones,
  // and the toggle works everywhere it is at the side. Only the phone bar at the bottom has no toggle.
  const narrow = useMedia('(max-width: 999px)')
  const [pref, setPref] = useState<'0' | '1' | null>(() => {
    try { const v = localStorage.getItem('lb-side-hidden'); return v === '1' || v === '0' ? v : null } catch { return null }
  })
  const sideHidden = pref === null ? narrow : pref === '1'
  const toggleSide = () => {
    const next = sideHidden ? '0' : '1'
    try { localStorage.setItem('lb-side-hidden', next) } catch { /* private mode */ }
    setPref(next)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && window.innerWidth >= 640) { e.preventDefault(); toggleSide() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
  const loc = useLocation()
  const canDecide = q.data ? isOwnerOrAdmin(q.data) || hodTeamIds(q.data).length > 0 : false
  const joinPending = usePendingJoinRequests(pid, canDecide).data?.length ?? 0
  const accessPending = (useAccessRequests(pid, canDecide).data ?? []).filter((r) => r.status === 'pending' && r.member_id !== q.data?.me.id).length
  const pending = joinPending + accessPending   // everything waiting for this person to decide

  if (q.isLoading) return <main className="lb-account"><p className="lb-caption">Loading project</p></main>
  if (q.isError || !q.data) {
    return (
      <main className="lb-account">
        <EmptyState title="This project is not available" action={<Link to="/" className="lb-btn lb-btn--primary">Back to projects</Link>}>
          {q.isError ? friendlyError(q.error) : 'You are not on this project.'}
        </EmptyState>
      </main>
    )
  }
  const b = q.data
  const base = `/p/${pid}`
  const seg = loc.pathname.replace(base, '').replace(/^\//, '')
  const current = SECTIONS.find((s) => s.path === seg) ?? SECTIONS[0]
  const ctx: Ctx = { b, pid: pid!, uid: user!.id }

  return (
    <>
      <header className="lb-topbar">
        <span className="lb-stripes" aria-hidden="true" />
        <Link to="/" className="lb-topback lb-phone-only" aria-label="All projects"><Icon name="chev" /></Link>
        <div className="lb-phone-hide">
          <Link to="/" style={{ textDecoration: 'none' }} aria-label="LineBoard, all projects"><Wordmark onDark /></Link>
        </div>
        <div className="lb-grow">
          <div className="lb-body-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.project.name}</div>
          <div className="lb-crumb">{current.label} · {myTeamNames(b)} · {roleLabel(b)}</div>
        </div>

        <Link to="/" className="lb-btn lb-btn--sm lb-phone-hide">Projects</Link>
        <Link to="/settings" className="lb-btn lb-btn--sm lb-phone-hide">Account</Link>
        <Link to="/settings" className="lb-avatar lb-phone-only" aria-label="Account">{(user?.email ?? '?').charAt(0).toUpperCase()}</Link>
      </header>
      {!online && <Banner kind="quiet" lead="Offline">Read-only. Changes need a connection.</Banner>}
      <div className={'lb-layout' + (sideHidden ? ' is-side-hidden' : '')}>
        <aside className="lb-side"><SectionNav b={b} pid={pid!} pending={pending} hidden={sideHidden} onToggle={toggleSide} /></aside>
        <main className="lb-content"><Outlet context={ctx} /></main>
      </div>
      <div className="lb-bottombar"><SectionDock b={b} pid={pid!} pending={pending} /></div>
    </>
  )
}
