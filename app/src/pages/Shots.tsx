import { useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Banner, EmptyState, Icon, SceneChip, SwipeRow, rowOpen, useOnline, type MenuItem } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { isOwnerOrAdmin, useScenes } from '../lib/project'
import { revisionLabel } from '../lib/script'
import { SECTIONS } from '../lib/sections'
import { useReportDownload } from '../components/ReportButton'
import { buildReportPdf, fileSafe } from '../lib/reportPdf'
import { shotsReport } from '../lib/reports'
import { STATUS_TEXT, canEditShotsFor, reorderChanges, shotLabel, sizeName, teamsIEdit, useShots, type Shot, type ShotStatus } from '../lib/shots'
import { framePaths, mb, removeFolder, totalBytes, useFrames, useSignedUrls, type Frame } from '../lib/storyboard'
import { buildStoryboardPdf } from '../lib/storyboardPdf'
import { armRowDrag } from '../lib/dragGate'
import { FoldAll } from '../components/FoldAll'
import { FrameThumb } from '../components/FrameThumb'
import { PageHeader } from '../components/PageHeader'
import { SceneJump } from '../components/SceneJump'
import { ShotWorkspace } from '../components/ShotWorkspace'
import { Mark, SceneFind, useSceneFind } from '../components/SceneFind'
import { matchScene } from '../lib/sceneSearch'
import { useFolded } from '../lib/folded'
import { supabase } from '../lib/supabase'
import type { Scene } from '../lib/types'

/** A shape and a word, never colour alone. */
function StatusMark({ status }: { status: ShotStatus }) {
  return (
    <span className={'lb-shotstatus lb-shotstatus--' + status}>
      {status === 'done' ? <Icon name="check" /> : status === 'dropped' ? <Icon name="cross" /> : <span className="lb-ring" aria-hidden="true" />}
      {STATUS_TEXT[status]}
    </span>
  )
}

export default function Shots() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const scenesQ = useScenes(pid)
  const shotsQ = useShots(pid)
  const scenes = useMemo(() => scenesQ.data ?? [], [scenesQ.data])
  const shots = useMemo(() => shotsQ.data ?? [], [shotsQ.data])
  const def = SECTIONS.find((s) => s.path === 'shots')!
  const st = navState(b, def)
  const canAdd = teamsIEdit(b).length > 0
  const [dlg, setDlg] = useState<{ shotId: string | null; sceneId: string; after: string | null; tab?: 'details' | 'frame' } | null>(null)
  const online = useOnline()
  const framesQ = useFrames(pid)
  const frames = useMemo(() => framesQ.data ?? new Map<string, Frame>(), [framesQ.data])
  const paths = useMemo(() => [...frames.values()].flatMap(framePaths), [frames])
  const urls = useSignedUrls(paths).data
  const capMb = b.project.image_cap_mb ?? 200
  const ratio = b.project.aspect_ratio ?? '16:9'
  const used = totalBytes(frames.values())
  const pct = Math.min(100, (used / (capMb * 1048576)) * 100)
  const [capEdit, setCapEdit] = useState<string | null>(null)
  const [showOmitted, setShowOmitted] = useState<Set<string>>(new Set())
  const fold = useFolded(pid, 'shots')
  const find = useSceneFind()
  const isOpen = (id: string) => (find.q ? true : fold.isOpen(id))   // a search opens what it finds without touching the saved choice
  const found = (sc: Scene, si: number) => matchScene(find.q, { number: sc.display_number ?? si + 1, heading: sc.heading })
  const [error, setError] = useState<string | null>(null)

  const bySceneId = useMemo(() => {
    const m = new Map<string, Shot[]>()
    for (const s of shots) m.set(s.scene_id, [...(m.get(s.scene_id) ?? []), s])
    return m
  }, [shots])
  const counts = { planned: 0, done: 0, dropped: 0 }
  for (const s of shots) counts[s.status]++
  const total = shots.length
  const [drag, setDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null)
  async function dropShot(s: Shot, overId: string | null, after: boolean) {
    const list = bySceneId.get(s.scene_id) ?? []
    if (!overId || overId === s.id) return
    const rest = list.filter((x) => x.id !== s.id)
    const oi = rest.findIndex((x) => x.id === overId)
    if (oi < 0) return
    const changes = reorderChanges(list, s.id, after ? oi + 1 : oi)
    if (!changes.length) return
    setError(null)
    const r = await Promise.all(changes.map((c) => supabase.from('shots').update({ position: c.position }).eq('id', c.id)))
    const err = r.find((x) => x.error)?.error
    if (err) setError(friendlyError(err))
    refresh()
  }
  function beginDrag(target: HTMLElement, pointerId: number, s: Shot) {
    try { target.setPointerCapture(pointerId) } catch { /* the pointer already ended */ }
    let state = { id: s.id, over: null as string | null, after: false }
    setDrag(state)
    const find = (ev: PointerEvent) => {
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-shot]')
      if (!row || row.dataset.scene !== s.scene_id) return { over: null, after: false }
      const r = row.getBoundingClientRect()
      return { over: row.dataset.shot!, after: ev.clientY > r.top + r.height / 2 }
    }
    const move = (ev: PointerEvent) => { state = { id: s.id, ...find(ev) }; setDrag(state) }
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cancel)
      const f = find(ev); setDrag(null); void dropShot(s, f.over, f.after)
    }
    const cancel = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cancel); setDrag(null) }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', cancel)
  }
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['shots', pid] })
    void qc.invalidateQueries({ queryKey: ['frames', pid] }); void qc.invalidateQueries({ queryKey: ['signed'] })
  }
  async function saveCap() {
    const n = Number(capEdit)
    if (!Number.isFinite(n) || n < 10 || n > 5000) { setError('Choose a limit between 10 and 5000 MB.'); return }
    setError(null)
    const { error: e } = await supabase.from('projects').update({ image_cap_mb: Math.round(n) }).eq('id', pid)
    if (e) { setError(friendlyError(e)); return }
    setCapEdit(null); void qc.invalidateQueries({ queryKey: ['project', pid] })
  }
  const teamName = (id: string) => b.teams.find((t) => t.id === id)?.name ?? 'No team'

  async function move(s: Shot, dir: -1 | 1) {
    const list = bySceneId.get(s.scene_id) ?? []
    const i = list.findIndex((x) => x.id === s.id)
    const other = list[i + dir]
    if (!other) return
    setError(null)
    // swap the two places. If they are tied, space the scene out first so the move is real.
    const a = s.position === other.position ? i * 10 + 10 : s.position
    const c = s.position === other.position ? (i + dir) * 10 + 10 : other.position
    const r = await Promise.all([
      supabase.from('shots').update({ position: c }).eq('id', s.id),
      supabase.from('shots').update({ position: a }).eq('id', other.id),
    ])
    const err = r.find((x) => x.error)?.error
    if (err) setError(friendlyError(err))
    refresh()
  }

  const pdf = useReportDownload(fileSafe(b.project.name) + '-shot-list', (size) => buildReportPdf(shotsReport({ project: b.project.name, size, scenes: scenesQ.data ?? [], shots, teams: b.teams })))
  const boardPdf = useReportDownload(fileSafe(b.project.name) + '-storyboard', () => buildStoryboardPdf({ scenes, bySceneId, frames, ratio, paths }))
  // The info bar shows facts only: the shot progress and, for the project owner and admins, the picture storage. Every action is in the hamburger.
  const info = (
    <>
      {total > 0 && (
        <span className="lb-shotprogress" aria-label="Progress">
          <span><b>{counts.done}</b> done · <b>{counts.dropped}</b> dropped · <b>{counts.planned}</b> planned</span>
          <span className="lb-meter" aria-hidden="true"><span style={{ width: `${(counts.done / total) * 100}%` }} /><span className="is-dropped" style={{ width: `${(counts.dropped / total) * 100}%` }} /></span>
        </span>
      )}
      {isOwnerOrAdmin(b) && (
        <span className="lb-shotprogress">
          <span><b>{mb(used)} MB</b> of {capMb} MB used</span>
          <span className="lb-meter" role="img" aria-label={`${Math.round(pct)} percent of the picture size limit used`}><span style={{ width: `${pct}%` }} /></span>
          {pct >= 90 && <Badge kind="conflict"><Icon name="warn" /> Nearly full</Badge>}
        </span>
      )}
    </>
  )
  const menu: MenuItem[] = [
    { label: 'Download shot list PDF', icon: 'download', disabled: total === 0 || pdf.busy, onClick: () => void pdf.go() },
    { label: 'Download storyboard PDF', icon: 'download', disabled: total === 0 || boardPdf.busy, onClick: () => void boardPdf.go() },
    { label: 'Change picture size limit', icon: 'pencil', hidden: !isOwnerOrAdmin(b) || capEdit !== null, onClick: () => setCapEdit(String(capMb)) },
  ]
  if (st.locked) {
    return (
      <>
        <PageHeader title="Shots" />
        <EmptyState title="Shots are not open to your team"
          action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>
          The admin can change this in Team and access.
        </EmptyState>
      </>
    )
  }

  const foldIds = scenes.filter((sc) => (bySceneId.get(sc.id)?.length ?? 0) > 0).map((sc) => sc.id)
  const dlgScene = dlg ? scenes.find((s) => s.id === dlg.sceneId) : undefined
  const dlgShot = dlg?.shotId ? shots.find((s) => s.id === dlg.shotId) ?? null : null
  return (
    <>
      <PageHeader title="Shots" info={info} menu={menu} quick={scenes.length > 0 ? (
        <>
          <SceneJump scenes={scenes.filter((sc) => (bySceneId.get(sc.id)?.length ?? 0) > 0)} />
          <FoldAll ids={foldIds} fold={fold} />
          <SceneFind find={find} shown={scenes.filter(found).length} />
        </>
      ) : undefined} />
      {(pdf.error || boardPdf.error) && <p className="lb-error" role="alert">{pdf.error || boardPdf.error}</p>}
      {!online && <Banner lead="Offline">Frames are blank without a connection. Download the storyboard as a PDF before you go somewhere with no signal.</Banner>}
      {isOwnerOrAdmin(b) && capEdit !== null && (
        <span className="lb-row">
          <input className="lb-input" style={{ width: 110, minHeight: 36 }} type="number" min={10} max={5000} value={capEdit} aria-label="Size limit in MB" onChange={(e) => setCapEdit(e.target.value)} />
          <button className="lb-btn lb-btn--sm" onClick={saveCap}>Save limit</button>
          <button className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => setCapEdit(null)}>Cancel</button>
        </span>
      )}
      {error && <p className="lb-error" role="alert">{error}</p>}
      {!scenesQ.isLoading && scenes.length === 0 && (
        <EmptyState title="No scenes yet" action={<Link className="lb-btn" to="../script">Open the Script</Link>}>Shots belong to scenes. Write or import the script first.</EmptyState>
      )}
      {scenes.length > 0 && (
        <div className="lb-sheet">
          <div className="lb-thead lb-shotrow lb-shothead">
            <span aria-hidden="true" /><span>Shot</span><span>Description</span><span>Size · movement</span><span>Lens</span><span>Team</span><span>Status</span><span />
          </div>
          {scenes.map((sc, si) => {
            if (!found(sc, si)) return null
            const list = bySceneId.get(sc.id) ?? []
            const omitted = sc.status === 'omitted'
            if (omitted && !showOmitted.has(sc.id)) {
              if (!list.length) return null
              return (
                <div key={sc.id} className="lb-shotscene lb-shotscene--omitted">
                  <span>Scene {sc.display_number ?? si + 1} omitted · {list.length} {list.length === 1 ? 'shot' : 'shots'} kept for reference</span>
                  <button className="lb-btn lb-btn--sm" onClick={() => setShowOmitted((s) => new Set(s).add(sc.id))}>Show</button>
                </div>
              )
            }
            return (
              <section key={sc.id} id={`scene-${sc.id}`} className="lb-shotscene" aria-label={`Scene ${sc.display_number ?? si + 1}`}>
                <header className="lb-shotscene-head">
                  <button className="lb-fold" aria-expanded={isOpen(sc.id)} onClick={() => fold.toggle(sc.id)}>
                    <Icon name="chev" />
                    <SceneChip n={sc.display_number} position={si + 1} omitted={omitted} />
                    <h2 className="lb-sp-h">{sc.heading ? <Mark text={sc.heading} query={find.q} /> : <span className="lb-muted">No heading yet</span>}</h2>
                    <span className="lb-caption lb-shotcount">{list.length} {list.length === 1 ? 'shot' : 'shots'}</span>
                  </button>
                  {sc.revised_in ? <Badge kind="conflict" ><Icon name="warn" /> Scene revised ({revisionLabel(sc.revised_in)}). Check these shots.</Badge> : null}
                  {canAdd && !omitted && <button className="lb-btn lb-btn--sm lb-addshot" aria-label="Add shot" onClick={() => setDlg({ shotId: null, sceneId: sc.id, after: null })}><Icon name="plus" /> <span className="lb-addshot-txt">Add shot</span></button>}
                </header>
                {isOpen(sc.id) && (
                <>
                {list.length === 0 && <p className="lb-caption lb-shotempty">No shots yet.</p>}
                {list.map((s, i) => {
                  const editable = canEditShotsFor(b, s.team_id)
                  return (
                    <SwipeRow key={s.id} label={`shot ${shotLabel(sc, si, i + 1)}`} canDelete={editable && !omitted} confirmText="The shot and its storyboard picture are removed. This cannot be undone."
                      onDelete={async () => { await removeFolder(`${pid}/${s.id}`).catch(() => undefined); const { data, error: e } = await supabase.from('shots').delete().eq('id', s.id).select('id'); if (e) throw new Error(friendlyError(e)); if (!data?.length) throw new Error('You do not have permission to do that.'); refresh() }}>
                    <div data-shot={s.id} data-scene={sc.id}
                      className={'lb-shotrow lb-shot is-click' + (s.status === 'dropped' ? ' is-dropped' : '') + (editable ? '' : ' is-other')
                        + (drag?.id === s.id ? ' is-dragging' : '') + (drag?.over === s.id ? (drag.after ? ' drop-after' : ' drop-before') : '')}
                      {...rowOpen(() => setDlg({ shotId: s.id, sceneId: sc.id, after: null }))}
                      onPointerDown={(e) => armRowDrag(e, (el, id) => beginDrag(el, id, s), editable && !omitted)}>
                      <button type="button" className="lb-shotthumb" aria-label={`Open the frame for shot ${shotLabel(sc, si, i + 1)}`} onClick={() => setDlg({ shotId: s.id, sceneId: sc.id, after: null, tab: 'frame' })}>
                        <FrameThumb small frame={frames.get(s.id)} urls={urls} offline={!online} ratio={ratio} />
                      </button>
                      <span className="lb-shotno">{shotLabel(sc, si, i + 1)}</span>
                      <button className="lb-shotdesc" onClick={() => setDlg({ shotId: s.id, sceneId: sc.id, after: null })}>
                        {s.description || <span className="lb-muted">No description</span>}
                        {s.silent && <Badge kind="plain">Silent</Badge>}
                      </button>
                      <span className="lb-shotmeta">
                        <span className="lb-shotcell">{[sizeName(s.size), s.movement].filter(Boolean).join(' · ') || <span className="lb-muted">–</span>}</span>
                        <span className="lb-shotcell">{s.lens || <span className="lb-muted">–</span>}</span>
                        <span className="lb-shotcell lb-shotteam" title={editable ? 'Your team can edit this shot' : 'Owned by another team'}>
                          <Icon name={editable ? 'pencil' : 'lock'} /> <span className="lb-shotteamname">{teamName(s.team_id)}</span>
                        </span>
                      </span>
                      <span className="lb-shotcell"><StatusMark status={s.status} /></span>
                      <span className="lb-shottools">
                        {editable && !omitted && (
                          <>
                            <button className="lb-btn lb-btn--sm lb-btn--quiet lb-grip" aria-label={`Drag shot ${shotLabel(sc, si, i + 1)} to a new place`} title="Drag to reorder" onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); beginDrag(e.currentTarget as HTMLElement, e.pointerId, s) }}><span aria-hidden="true">⋮⋮</span></button>
                            <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Move shot ${shotLabel(sc, si, i + 1)} up`} disabled={i === 0} onClick={() => move(s, -1)}>↑</button>
                            <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Move shot ${shotLabel(sc, si, i + 1)} down`} disabled={i === list.length - 1} onClick={() => move(s, 1)}>↓</button>
                          </>
                        )}
                      </span>
                    </div>
                    </SwipeRow>
                  )
                })}
                {list.length > 0 && canAdd && !omitted && (
                  <div className="lb-shotend"><button className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => setDlg({ shotId: null, sceneId: sc.id, after: list[list.length - 1].id })}><Icon name="plus" /> Add a shot after {shotLabel(sc, si, list.length)}</button></div>
                )}
                </>
                )}
              </section>
            )
          })}
          {find.q && !scenes.some(found) && <p className="lb-caption lb-shotempty" role="status">No scenes match “{find.q}”.</p>}
        </div>
      )}
      {dlg && dlgScene && (
        <ShotWorkspace
          key={dlg.shotId ?? `new-${dlg.sceneId}-${dlg.after}`}
          tab={dlg.tab ?? 'details'}
          shot={dlgShot} scene={dlgScene} sceneIndex={scenes.findIndex((s) => s.id === dlgScene.id)}
          inScene={bySceneId.get(dlgScene.id) ?? []} after={dlg.after}
          onClose={() => setDlg(null)} onSaved={refresh}
          openShot={(id) => setDlg({ shotId: id, sceneId: dlgScene.id, after: null })}
          frame={dlgShot ? frames.get(dlgShot.id) : undefined} urls={urls} ratio={ratio} pid={pid}
          usedByOthers={used - (dlgShot ? frames.get(dlgShot.id)?.bytes ?? 0 : 0)} capBytes={capMb * 1048576}
          showUsage={isOwnerOrAdmin(b)} canEditFrame={dlgShot ? canEditShotsFor(b, dlgShot.team_id) : false}
        />
      )}
    </>
  )
}
