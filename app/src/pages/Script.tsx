import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, useLocation, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Banner, Dialog, EmptyState, Icon, Permission, SceneChip, useAction } from '../components/ui'
import { SceneNav } from '../components/SceneNav'
import { useMedia } from '../components/ProjectLayout'
import { removeFolder } from '../lib/storyboard'
import { ELEMENT_LABELS, LINES_PER_PAGE, estimateLines, looksLikeHeading, parseFountain, toFountain, type Element } from '../lib/fountain'
import { buildPdf, layoutScript, toFdx, toFountainFile, type ExportScene } from '../lib/exportScript'
import { friendlyError } from '../lib/errors'
import { isOwner, isOwnerOrAdmin, levelFor, useScenes } from '../lib/project'
import {
  acquireLock, canReadScene, placeAfter, releaseLock, revisionColour, revisionLabel, saveSceneText,
  useMyScriptAccess, useSceneLocks, useSceneTexts, type SceneText,
} from '../lib/script'
import { SECTIONS } from '../lib/sections'
import { supabase } from '../lib/supabase'
import { useScriptZoom, ZOOM_STEPS } from '../lib/zoom'
import type { Scene } from '../lib/types'
import type { CSSProperties } from 'react'

class UserMessage extends Error {}
function pagesText(lines: number): string {
  const n = Math.max(0.1, lines / LINES_PER_PAGE)
  return n < 1 ? 'less than a page' : n < 1.5 ? 'a page' : `${Math.round(n)} pages`
}
const aboutPages = (lines: number) => { const t = pagesText(lines); return t.startsWith('less') ? t.replace(/^l/, 'L') : `About ${t}` }
/** Holds on scenes are given back a moment after an editor closes, so a quick remount does not lose them. */
const pendingRelease = new Map<string, ReturnType<typeof setTimeout>>()

/** Lines changed after the lock carry a revision mark: a coloured bar and an asterisk in the margin. */
function markProps(e: Element): { 'data-rev'?: number; style?: CSSProperties; title?: string } {
  if (!e.rev) return {}
  return { 'data-rev': e.rev, style: { '--rev': revisionColour(e.rev) } as CSSProperties, title: `Changed in the ${revisionLabel(e.rev)} revision` }
}

/** Standard screenplay layout for a list of typed elements. */
function Screenplay({ elements }: { elements: Element[] }) {
  const blocks: { key: number; node: ReactElement }[] = []
  let i = 0
  while (i < elements.length) {
    const e = elements[i]
    if (e.kind === 'character') {
      const start = i
      const group: ReactElement[] = [<p key={i} className="lb-sp-char" {...markProps(e)}>{e.text}</p>]
      i++
      while (i < elements.length && (elements[i].kind === 'dialogue' || elements[i].kind === 'parenthetical')) {
        const d = elements[i]
        group.push(<p key={i} className={d.kind === 'dialogue' ? 'lb-sp-dlg' : 'lb-sp-par'} {...markProps(d)}>{d.text}</p>)
        i++
      }
      blocks.push({ key: start, node: <div className="lb-sp-group">{group}</div> })
    } else {
      blocks.push({ key: i, node: <p className={e.kind === 'transition' ? 'lb-sp-trans' : 'lb-sp-act'} {...markProps(e)}>{e.text}</p> })
      i++
    }
  }
  return <div className="lb-sp">{blocks.map((b) => <div key={b.key}>{b.node}</div>)}</div>
}

interface EditorProps {
  scene: Scene | null            // null = a new scene
  after: string | null           // for a new scene: the scene it follows (null = at the end)
  scenes: Scene[]
  locked: boolean
  revisionNo: number
  pid: string
  initial: SceneText | undefined
  onDone: (changed: boolean) => void
}

export function SceneEditor({ scene, after, scenes, locked, revisionNo, pid, initial, onDone }: EditorProps) {
  const [heading, setHeading] = useState(scene?.heading ?? '')
  const startBody = useMemo(() => toFountain(initial?.elements ?? []), [initial])
  const [body, setBody] = useState(startBody)
  const [rev, setRev] = useState(initial?.rev ?? 0)
  const [error, setError] = useState<string | null>(null)
  const [lost, setLost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const qcEditor = useQueryClient()
  const [numberText, setNumberText] = useState(scene?.display_number ?? '')
  async function changeNumber() {
    if (!scene || !numberText.trim() || numberText.trim() === scene.display_number) return
    setBusy(true); setError(null)
    const { error: e } = await supabase.from('scenes').update({ display_number: numberText.trim() }).eq('id', scene.id)
    setBusy(false)
    if (e) setError(friendlyError(e)); else void qcEditor.invalidateQueries({ queryKey: ['scenes', pid] })
  }
  const sceneId = scene?.id
  const dirty = body !== startBody || heading !== (scene?.heading ?? '') || (!scene && (body !== '' || heading !== ''))

  // Keep the hold on the scene alive while this editor is open, and let go when it closes.
  useEffect(() => {
    if (!sceneId) return
    const p = pendingRelease.get(sceneId)
    if (p) { clearTimeout(p); pendingRelease.delete(sceneId) }
    const t = setInterval(async () => {
      try { const r = await acquireLock(sceneId); setLost(!r.mine) } catch { setLost(true) }
    }, 45_000)
    return () => {
      clearInterval(t)
      pendingRelease.set(sceneId, setTimeout(() => { pendingRelease.delete(sceneId); void releaseLock(sceneId) }, 400))
    }
  }, [sceneId])

  const elements = useMemo(() => parseFountain(body), [body])
  const extraHeading = body.split('\n').some((l) => looksLikeHeading(l))
  const lines = estimateLines(heading, elements)
  const taRef = useRef<HTMLTextAreaElement>(null)

  async function retake() {
    if (!sceneId) return
    try { const r = await acquireLock(sceneId); setLost(!r.mine); if (r.mine) setError(null) } catch (e) { setError(friendlyError(e)) }
  }
  async function loadLatest() {
    if (!sceneId) return
    const [t, s] = await Promise.all([
      supabase.from('scene_text').select('elements, rev').eq('scene_id', sceneId).maybeSingle(),
      supabase.from('scenes').select('heading').eq('id', sceneId).single(),
    ])
    setBody(toFountain((t.data?.elements as Element[]) ?? [])); setRev(t.data?.rev ?? 0)
    if (s.data) setHeading(s.data.heading)
    setError(null)
  }
  async function save() {
    setBusy(true); setError(null)
    try {
      const h = heading.trim().toUpperCase()
      let id = sceneId
      let expected = rev
      if (!id) {
        const place = placeAfter(scenes, after)
        if (place.renumber) {
          await Promise.all(scenes.map((s, i) => supabase.from('scenes').update({ sort_order: (i + 1) * 10 }).eq('id', s.id)))
        }
        const sort = place.renumber ? (scenes.findIndex((s) => s.id === after) + 1) * 10 + 5 : place.sort_order
        // No number is sent: the database leaves it blank before the lock and gives it one after.
        const ins = await supabase.from('scenes').insert({ project_id: pid, heading: h, sort_order: sort }).select('id').single()
        if (ins.error) throw ins.error
        id = ins.data.id as string
        expected = 0
        const r = await acquireLock(id)
        if (!r.mine) throw new Error('lock_lost')
      }
      await saveSceneText(id, h, elements, expected)
      if (!sceneId) await releaseLock(id)
      onDone(true)
    } catch (e) {
      if (/lock_lost/.test(String((e as { message?: string })?.message))) setLost(true)
      setError(e instanceof UserMessage ? e.message : friendlyError(e))
    } finally { setBusy(false) }
  }
  function cancel() {
    if (dirty && !confirmDiscard) { setConfirmDiscard(true); return }
    onDone(false)
  }

  return (
    <section className="lb-card lb-editor" aria-label={scene ? `Editing scene ${scene.display_number ?? 'without a number'}` : 'New scene'}>
      <div className="lb-editor-head">
        <Permission level="edit" />
        <span className="lb-caption">
          {scene ? 'You are the only one who can change this scene until you save or cancel. Others see that you are writing.' : 'A new scene.'}
          {' '}{locked
            ? `The script is locked, so what you save is marked in the ${revisionLabel(revisionNo)} revision${scene ? '' : ', and the scene gets its number now (a letter between two scenes, or the next whole number at the end)'}.`
            : 'The script is not locked yet, so scenes have no numbers.'}
        </span>
      </div>
      <div className="lb-editor-fields">
        {scene && (
          <div className="lb-field" style={{ flex: '0 0 auto' }}>
            <span className="lb-label">Scene</span>
            <SceneChip n={scene.display_number} position={scenes.findIndex((x) => x.id === scene.id) + 1} />
          </div>
        )}
        {scene && scene.display_number !== null && !locked && (
          <div className="lb-field" style={{ flex: '0 1 220px' }}>
            <label htmlFor="sc-number">Scene number</label>
            <span className="lb-row" style={{ flexWrap: 'nowrap' }}>
              <input id="sc-number" className="lb-input" value={numberText} onChange={(e) => setNumberText(e.target.value)} style={{ minWidth: 0 }} />
              <button type="button" className="lb-btn" disabled={busy || !numberText.trim() || numberText.trim() === scene.display_number} onClick={() => void changeNumber()}>Change</button>
            </span>
            <span className="lb-caption">You can fix a number by hand while the script is unlocked.</span>
          </div>
        )}
        <div className="lb-field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="sc-heading">Scene heading</label>
          <input id="sc-heading" className="lb-input lb-script-input" value={heading} placeholder="INT. KITCHEN - DAY" onChange={(e) => setHeading(e.target.value)} />
        </div>
      </div>
      <div className="lb-editor-split">
        <div className="lb-field">
          <label htmlFor="sc-body">Scene text</label>
          <textarea id="sc-body" ref={taRef} className="lb-input lb-script-input lb-textarea" value={body} spellCheck
            rows={Math.max(12, body.split('\n').length + 2)} onChange={(e) => setBody(e.target.value)}
            placeholder={'Write action as plain paragraphs.\n\nANNA\n(quietly)\nNot yet.\n\nCUT TO:'} />
          <span className="lb-caption">Fountain: a blank line starts a new block. A line in capitals with text under it is a character. Start a line with ! to force action, @ to force a character, or &gt; for a transition.</span>
        </div>
        <div className="lb-field">
          <span className="lb-label">How it reads</span>
          <div className="lb-preview">
            {heading.trim() && <p className="lb-sp-h">{heading.trim().toUpperCase()}</p>}
            {elements.length ? <Screenplay elements={elements} /> : <p className="lb-caption">Nothing yet.</p>}
          </div>
        </div>
      </div>
      <div className="lb-row lb-caption">
        {(['action', 'character', 'dialogue', 'parenthetical', 'transition'] as const).map((k) => {
          const n = elements.filter((e) => e.kind === k).length
          return n ? <span key={k}>{n} {ELEMENT_LABELS[k].toLowerCase()}</span> : null
        })}
        <span>{aboutPages(lines)}</span>
      </div>
      {extraHeading && <Banner lead="Another scene heading?">A scene is written on its own. Save this one, then use Write a scene after this one for the next.</Banner>}
      {lost && <Banner kind="alert" lead="You lost this scene" action={<button className="lb-btn lb-btn--sm" onClick={retake}>Take it back</button>}>Your hold ran out or someone else took it. Your text is still here.</Banner>}
      {error && (
        <p className="lb-error" role="alert">{error}{' '}
          {/another scene|saved this scene/i.test(error) && <button type="button" className="lb-btn lb-btn--sm" onClick={loadLatest}>Load the latest version</button>}
        </p>
      )}
      <div className="lb-actions">
        <button className="lb-btn" onClick={cancel} disabled={busy}>{confirmDiscard ? 'Discard changes' : 'Cancel'}</button>
        <button className="lb-btn lb-btn--primary" onClick={save} disabled={busy || lost || (!scene && !heading.trim())}>{busy ? 'Saving' : 'Save scene'}</button>
      </div>
    </section>
  )
}

export default function Script() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const routeState = useLocation().state as { imported?: number; draft?: string } | null
  const imported = routeState?.imported
  const draftNote = routeState?.draft
  const sq = useScenes(pid)
  const scenes = useMemo(() => sq.data ?? [], [sq.data])
  const everything = isOwnerOrAdmin(b)
  const access = useMyScriptAccess(b.me.id, everything)
  const ids = useMemo(() => scenes.map((s) => s.id), [scenes])
  const texts = useSceneTexts(pid, ids)
  const locks = useSceneLocks(pid, ids)
  const level = levelFor(b, 'script')
  const canEdit = level === 'edit'
  const locked = b.project.script_locked
  const zoom = useScriptZoom()
  const def = SECTIONS.find((s) => s.path === 'script')!
  const st = navState(b, def)
  const [editing, setEditing] = useState<string | null>(null)
  const [writing, setWriting] = useState<{ after: string | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [initialFor, setInitialFor] = useState<SceneText | undefined>(undefined)

  const nameOf = (uid: string) => b.people.find((p) => p.account_id === uid)?.name ?? 'Someone'
  const readable = (id: string) => canReadScene(everything, access.data, id)
  const refresh = () => {
    for (const k of ['scenes', 'scene_text', 'scene_locks']) void qc.invalidateQueries({ queryKey: [k, pid] })
    void qc.invalidateQueries({ queryKey: ['project', pid] })
  }

  async function startEdit(s: Scene) {
    setNotice(null)
    try {
      const r = await acquireLock(s.id)
      if (!r.mine) { setNotice(`${r.name ?? 'Someone'} is writing ${s.display_number ? 'scene ' + s.display_number : 'this scene'} right now. Try again in a moment.`); refresh(); return }
      // read the freshest text after the lock is ours
      const t = await supabase.from('scene_text').select('scene_id, elements, rev, updated_at').eq('scene_id', s.id).maybeSingle()
      setInitialFor((t.data as SceneText | null) ?? undefined)
      setWriting(null); setEditing(s.id)
    } catch (e) { setNotice(friendlyError(e)) }
  }
  function startWriting(after: string | null) {
    setNotice(null); setEditing(null); setInitialFor(undefined); setWriting({ after })
  }
  function done(changed: boolean) {
    setEditing(null); setWriting(null); setInitialFor(undefined)
    if (changed) setNotice(null)
    refresh()
  }
  const [nextRevDialog, setNextRevDialog] = useState(false)
  const revAct = useAction()
  const canStartRevision = locked && isOwnerOrAdmin(b)
  async function startNextRevision() {
    const ok = await revAct.run(async () => {
      const { error } = await supabase.rpc('start_next_revision', { pid })
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) { setNextRevDialog(false); refresh() }
  }

  const active = scenes.filter((s) => s.status === 'active')
  const totalLines = active.reduce((n, s) => {
    const t = texts.data?.get(s.id)
    return t ? n + estimateLines(s.heading, t.elements) : n
  }, 0)

  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const fileBase = b.project.name.replace(/[^\w-]+/g, '_') || 'script'
  function exportScenes(): ExportScene[] {
    // only what this person may read; omitted scenes have no text to hide
    return scenes.filter((s) => s.status === 'omitted' || readable(s.id)).map((s) => ({
      number: s.display_number, heading: s.heading, omitted: s.status === 'omitted',
      elements: texts.data?.get(s.id)?.elements ?? [], revisedIn: s.revised_in,
    }))
  }
  function download(blob: Blob, name: string) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  async function runExport(kind: 'pdf' | 'fdx' | 'fountain') {
    setExporting(kind); setExportError(null)
    try {
      const sc = exportScenes()
      if (kind === 'pdf') {
        const blob = await buildPdf(layoutScript(sc), { title: b.project.name, revision: locked ? revisionLabel(b.project.revision_no) : null })
        download(blob, `${fileBase}.pdf`)
      } else if (kind === 'fdx') {
        download(new Blob([toFdx(sc)], { type: 'application/xml' }), `${fileBase}.fdx`)
      } else {
        download(new Blob([toFountainFile(sc)], { type: 'text/plain;charset=utf-8' }), `${fileBase}.fountain`)
      }
      setExportOpen(false)
    } catch (e) { setExportError(friendlyError(e)) } finally { setExporting(null) }
  }

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">Script</h1>
      <div className="lb-row">
        {locked ? <Badge kind="locked">Locked</Badge> : <Badge kind="plain">Unlocked</Badge>}
        {locked && <span className="lb-revtag" style={{ '--rev': revisionColour(b.project.revision_no) } as CSSProperties} title="Changes saved now are marked in this revision">Revision: {revisionLabel(b.project.revision_no)}</span>}
        {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={canEdit ? 'edit' : 'view'} />}
      </div>
    </div>
  )

  if (st.locked) {
    return (
      <>
        {head}
        <EmptyState title="The script is not open to your team"
          action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>
          The admin can change this in Team and access.
        </EmptyState>
      </>
    )
  }

  // ---- the scene list beside the script
  const phone = useMedia('(max-width: 639px)')
  const wideScreen = useMedia('(min-width: 1200px)')
  const [navPref, setNavPref] = useState<'0' | '1' | null>(() => { try { const v = localStorage.getItem('lb-scenenav'); return v === '1' || v === '0' ? v : null } catch { return null } })
  const navCollapsed = navPref === null ? !wideScreen : navPref === '1'
  const toggleNav = () => { const next = navCollapsed ? '0' : '1'; try { localStorage.setItem('lb-scenenav', next) } catch { /* private window */ } setNavPref(next) }
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const sceneKey = scenes.map((s) => s.id).join(',')
  useEffect(() => {
    const els = scenes.map((s) => document.getElementById(`scene-${s.id}`)).filter((e): e is HTMLElement => Boolean(e))
    if (!els.length || typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, number>()
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) { if (en.isIntersecting) seen.set(en.target.id, en.boundingClientRect.top); else seen.delete(en.target.id) }
      const first = [...seen.entries()].sort((a, z) => a[1] - z[1])[0]
      if (first) setActiveId(first[0].replace('scene-', ''))
    }, { rootMargin: '-72px 0px -60% 0px' })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, st.locked, editing, writing])
  function goTo(id: string) {
    setActiveId(id); setSheetOpen(false)
    document.getElementById(`scene-${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
  const navAct = useAction()
  async function deleteScene(sc: Scene) {
    // storyboard pictures of this scene's shots go with it
    const { data: sh } = await supabase.from('shots').select('id').eq('scene_id', sc.id)
    for (const x of sh ?? []) await removeFolder(`${pid}/${x.id}`).catch(() => undefined)
    const { error } = await supabase.from('scenes').delete().eq('id', sc.id)
    if (error) throw new Error(friendlyError(error))
    refresh()
  }
  async function setStatus(sc: Scene, status: 'active' | 'omitted') {
    await navAct.run(async () => {
      const { error } = await supabase.from('scenes').update({ status }).eq('id', sc.id)
      if (error) throw error
      refresh()
    }, friendlyError)
  }
  const [lockDialog, setLockDialog] = useState(false)
  async function toggleLock() {
    const ok = await navAct.run(async () => {
      // Locking numbers every scene in script order, then freezes the numbers (one step in the database).
      const { error } = locked ? await supabase.from('projects').update({ script_locked: false }).eq('id', pid) : await supabase.rpc('lock_script', { pid })
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) { refresh(); setLockDialog(false) }
  }
  const navProps = { scenes, activeId, onGo: goTo, canEdit, locked, onDelete: deleteScene, onStatus: setStatus }

  const anyReadable = active.some((s) => readable(s.id))
  return (
    <>
      {head}
      <p className="lb-caption">Everyone on the project sees every scene heading. Action and dialogue show only for scenes shared with you. One person writes a scene at a time. Scenes get their numbers when the admin locks the script.</p>
      <div className="lb-row">
        {canEdit && !writing && <button className="lb-btn lb-btn--primary" onClick={() => startWriting(null)}><Icon name="plus" /> Write a scene</button>}
        {isOwner(b) && !writing && <Link className="lb-btn" to="import">{scenes.length ? 'Import a new draft' : 'Import a script'}</Link>}
        {(anyReadable || active.length > 0) && <button className="lb-btn" onClick={() => { setExportError(null); setExportOpen(true) }}>Export</button>}
        {canStartRevision && <button className="lb-btn" onClick={() => setNextRevDialog(true)}>Start next revision</button>}
        {isOwner(b) && <button className="lb-btn" onClick={() => { navAct.setError(null); setLockDialog(true) }}><Icon name="lock" /> {locked ? 'Unlock script' : 'Lock script'}</button>}
        {totalLines > 0 && <span className="lb-caption">{aboutPages(totalLines)} in the scenes you can read</span>}
      </div>
      {navAct.error && !lockDialog && <p className="lb-error" role="alert">{navAct.error}</p>}
      <div className={'lb-scriptlayout' + (phone || scenes.length === 0 ? ' is-single' : '') + (navCollapsed ? ' is-collapsed' : '')}>
      {!phone && scenes.length > 0 && <aside className="lb-scenenav-wrap"><SceneNav {...navProps} collapsed={navCollapsed} onToggle={toggleNav} /></aside>}
      <div className="lb-scriptmain" ref={zoom.setEl}>
      {draftNote ? <Banner lead="New draft">{draftNote} Changed scenes are tagged with the revision, and numbers did not move.</Banner> : null}
      {imported ? <Banner lead="Imported">{imported} {imported === 1 ? 'scene was' : 'scenes were'} added to the script.</Banner> : null}
      {notice && <Banner kind="alert" lead="Cannot edit yet">{notice}</Banner>}
      {writing && writing.after === null && (
        <SceneEditor key="new-end" scene={null} after={null} scenes={scenes} locked={locked} revisionNo={b.project.revision_no} pid={pid} initial={undefined} onDone={done} />
      )}
      {!sq.isLoading && scenes.length === 0 && !writing && (
        <EmptyState title="No script yet">
          {canEdit ? 'Write the first scene here. Each scene becomes a record the shot list, breakdown and schedule attach to.' : 'The admin or a writer will add scenes here.'}
        </EmptyState>
      )}
      {scenes.length > 0 && (
        <>
        {phone && (
          <div className="lb-scenebar">
            <button type="button" className="lb-btn lb-btn--sm lb-scenebar-btn" aria-expanded={sheetOpen} aria-controls="scenebar-panel" onClick={() => setSheetOpen((v) => !v)}>
              <Icon name="panel" /> Scenes {active.length}{activeId ? ` · ${scenes.find((x) => x.id === activeId)?.display_number ?? 'now'}` : ''}
            </button>
            {sheetOpen && <div id="scenebar-panel" className="lb-scenebar-panel"><SceneNav {...navProps} collapsed={false} onToggle={() => undefined} showToggle={false} /></div>}
          </div>
        )}
        <div className="lb-paper" style={{ '--z': zoom.percent / 100 } as CSSProperties}>
          {scenes.map((s, idx) => {
            const num = s.display_number
            const numEl = <span className={'lb-sd-num' + (num === null ? ' is-draft' : '')} title={num === null ? 'Not numbered until the script is locked' : `Scene ${num}`}>{num ?? idx + 1}</span>
            if (s.status === 'omitted') {
              return (
                <div key={s.id} className="lb-sd lb-sd--omitted" id={`scene-${s.id}`}>
                  <div className="lb-sd-head">{numEl}<span className="lb-sp-h">{s.heading || 'Scene'} <span className="lb-sd-omit">Omitted</span></span></div>
                </div>
              )
            }
            if (editing === s.id) {
              return <div key={s.id} id={`scene-${s.id}`}><SceneEditor scene={s} after={null} scenes={scenes} locked={locked} revisionNo={b.project.revision_no} pid={pid} initial={initialFor} onDone={done} /></div>
            }
            const t = texts.data?.get(s.id)
            const can = readable(s.id)
            const lk = locks.data?.get(s.id)
            const someoneElse = lk && lk.holder !== b.me.account_id
            return (
              <div key={s.id} className="lb-sd" id={`scene-${s.id}`}>
                <header className="lb-sd-head">
                  {numEl}
                  <h2 className="lb-sp-h">{s.heading || <span className="lb-muted">No heading yet</span>}</h2>
                  <span className="lb-sd-tools">
                    {s.revised_in ? <span className="lb-revtag" style={{ '--rev': revisionColour(s.revised_in) } as CSSProperties} title="Changed after the lock. Check what depends on this scene.">{revisionLabel(s.revised_in)} revision</span> : null}
                    {someoneElse && <span className="lb-sd-note"><Icon name="pencil" /> Being edited by {nameOf(lk.holder)}</span>}
                    {canEdit && can && !someoneElse && !writing && <button className="lb-btn lb-btn--sm" onClick={() => startEdit(s)}>Edit</button>}
                  </span>
                </header>
                {can ? (
                  t && t.elements.length ? <Screenplay elements={t.elements} /> : <p className="lb-caption lb-sd-body">{texts.isLoading ? 'Loading' : 'No text yet.'}</p>
                ) : (
                  <p className="lb-sd-body lb-rolock"><Icon name="lock" /><span className="lb-sr">This scene's text is not shared with you.</span></p>
                )}
                <div className="lb-sd-end">
                  {canEdit && !writing && (
                    <button className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => startWriting(s.id)}><Icon name="plus" /> Write a scene after {s.display_number ?? 'this one'}</button>
                  )}
                </div>
                {writing && writing.after === s.id && (
                  <SceneEditor key={'new-' + s.id} scene={null} after={s.id} scenes={scenes} locked={locked} revisionNo={b.project.revision_no} pid={pid} initial={undefined} onDone={done} />
                )}
              </div>
            )
          })}
        </div>
        </>
      )}
      </div>
      </div>
      {lockDialog && (
        <Dialog title={locked ? 'Unlock the script?' : 'Lock the script?'} onClose={() => setLockDialog(false)} badge={<Badge kind={locked ? 'conflict' : 'locked'}>{locked ? 'Numbers can be fixed again' : 'Numbers freeze'}</Badge>}>
          {locked
            ? <p>Existing numbers stay as they are, but you can fix one by hand, and scenes you add or remove while unlocked are not numbered until you lock again. Anything built on the numbers may need checking.</p>
            : <p>Every scene is numbered now, 1, 2, 3 in script order, and the numbers freeze. A scene added later gets a letter between two scenes (42A) or the next whole number at the end. A cut scene stays in the list as omitted.</p>}
          {navAct.error && <p className="lb-error" role="alert">{navAct.error}</p>}
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setLockDialog(false)}>Cancel</button>
            <button className={'lb-btn ' + (locked ? 'lb-btn--danger' : 'lb-btn--primary')} disabled={navAct.busy} onClick={toggleLock}>{locked ? 'Unlock script' : 'Lock script'}</button>
          </div>
        </Dialog>
      )}
      {exportOpen && (
        <Dialog title="Export the script" onClose={() => setExportOpen(false)}>
          <p>The file has the scenes you can read{locked ? ', with scene numbers' : ', without numbers because the script is not locked'}. {locked ? `Lines changed after the lock carry an asterisk in the margin in the PDF, and the page header names the ${revisionLabel(b.project.revision_no)} revision.` : ''}</p>
          <div className="lb-stack">
            <button className="lb-btn" disabled={exporting !== null} onClick={() => runExport('pdf')}>{exporting === 'pdf' ? 'Making the PDF' : 'PDF in screenplay layout'}</button>
            <button className="lb-btn" disabled={exporting !== null} onClick={() => runExport('fdx')}>Final Draft file (.fdx)</button>
            <button className="lb-btn" disabled={exporting !== null} onClick={() => runExport('fountain')}>Fountain text (.fountain)</button>
          </div>
          {exportError && <p className="lb-error" role="alert">{exportError}</p>}
          <div className="lb-actions"><button className="lb-btn" onClick={() => setExportOpen(false)}>Close</button></div>
        </Dialog>
      )}
      {nextRevDialog && (
        <Dialog title="Start the next revision?" onClose={() => setNextRevDialog(false)}>
          <p>Changes saved from now on are marked in the {revisionLabel(b.project.revision_no + 1)} revision. Marks from the {revisionLabel(b.project.revision_no)} revision stay where they are. Do this when a round of changes has been issued to the crew.</p>
          {revAct.error && <p className="lb-error" role="alert">{revAct.error}</p>}
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setNextRevDialog(false)}>Cancel</button>
            <button className="lb-btn lb-btn--primary" disabled={revAct.busy} onClick={startNextRevision}>Start {revisionLabel(b.project.revision_no + 1)} revision</button>
          </div>
        </Dialog>
      )}
      {scenes.length > 0 && (
        <div className="lb-zoom" role="group" aria-label="Zoom the script">
          <button type="button" className="lb-zoom-btn" onClick={() => zoom.step(-1)} disabled={zoom.percent <= 50} aria-label="Zoom out" title="Zoom out (Ctrl or Cmd and minus)">&minus;</button>
          <select className="lb-zoom-sel" aria-label="Zoom level" value={zoom.value === 'fit' ? 'fit' : String(zoom.value)} onChange={(e) => zoom.setValue(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
            {zoom.value !== 'fit' && !(ZOOM_STEPS as readonly number[]).includes(zoom.value) && <option value={String(zoom.value)}>{zoom.value}%</option>}
            {ZOOM_STEPS.map((z) => <option key={z} value={String(z)}>{z}%</option>)}
            <option value="fit">Fit width ({zoom.percent}%)</option>
          </select>
          <button type="button" className="lb-zoom-btn" onClick={() => zoom.step(1)} disabled={zoom.percent >= 200} aria-label="Zoom in" title="Zoom in (Ctrl or Cmd and plus)">+</button>
        </div>
      )}
    </>
  )
}
