import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Banner, EmptyState, Icon, Permission, SceneChip, useOnline } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { isOwnerOrAdmin, levelFor, useScenes } from '../lib/project'
import { SECTIONS } from '../lib/sections'
import { canEditShotsFor, shotLabel, useShots, type Shot } from '../lib/shots'
import {
  BUCKET, ImageProblem, MAX_LAYERS, MAX_STROKES, STAGE_H, STAGE_W, addPoint, compressImage, flatten, framePaths, gridCells,
  loadImage, mb, paintFrame, removeFiles, totalBytes, uploadImage, useFrames, useSignedUrls,
  toDraw, type DrawLayer, type Frame, type Layer, type Stroke,
} from '../lib/storyboard'
import { supabase } from '../lib/supabase'
import type { Scene } from '../lib/types'

const COLORS = ['#111111', '#d11a1a', '#1f5fd1']
const WIDTHS = [3, 6, 12]

/** A small picture of a frame: the flattened image when it is done, otherwise the layers and drawing painted on the spot. */
function FrameThumb({ frame, urls, offline }: { frame: Frame | undefined; urls: Map<string, string> | undefined; offline: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const flatUrl = frame?.done && frame.flat_path ? urls?.get(frame.flat_path) : undefined
  useEffect(() => {
    setFailed(false)
    if (!frame || frame.done || !urls) return
    let live = true
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    paintFrame(ctx, c.width, c.height, [], frame.strokes)
    Promise.all(frame.layers.map(async (l) => {
      const img = await loadImage(urls.get(l.path) ?? '')
      return toDraw(l, img, img.naturalWidth, img.naturalHeight)
    })).then((ls) => { if (live) paintFrame(ctx, c.width, c.height, ls, frame.strokes) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [frame, urls])
  if (!frame) return <div className="lb-frame lb-frame--empty"><span className="lb-caption">No frame yet</span></div>
  if (offline || failed) return <div className="lb-frame lb-frame--empty"><Icon name="cloudoff" /><span className="lb-caption">{offline ? 'Offline. Frames are blank.' : 'The picture did not load.'}</span></div>
  if (frame.done) return flatUrl ? <img className="lb-frame" src={flatUrl} alt="Finished frame" loading="lazy" /> : <div className="lb-frame lb-frame--empty"><span className="lb-caption">Loading</span></div>
  return <canvas ref={ref} className="lb-frame" width={480} height={270} aria-label="Frame sketch" />
}

interface EditorProps {
  shot: Shot; label: string; scene: Scene; frame: Frame | undefined; canEdit: boolean
  urls: Map<string, string> | undefined; usedByOthers: number; capBytes: number
  pid: string; onClose: () => void; onSaved: () => void
}

function FrameEditor({ shot, label, scene, frame, canEdit, urls, usedByOthers, capBytes, pid, onClose, onSaved }: EditorProps) {
  const [layers, setLayers] = useState<Layer[]>(frame?.layers ?? [])
  const [strokes, setStrokes] = useState<Stroke[]>(frame?.strokes ?? [])
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  const [tool, setTool] = useState<'pen' | 'eraser' | 'move'>('pen')
  const [sel, setSel] = useState(0)            // the photo layer the Move tool drags
  const grab = useRef<{ x: number; y: number; lx: number; ly: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imgs, setImgs] = useState<Map<string, DrawLayer>>(new Map())
  const uploaded = useRef<string[]>([])
  const saved = useRef(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<Stroke | null>(null)
  const isDone = Boolean(frame?.done)
  const flatUrl = frame?.flat_path ? urls?.get(frame.flat_path) : undefined
  const bytes = layers.reduce((n, l) => n + l.bytes, 0)

  // load the pictures of the layers this frame already has
  useEffect(() => {
    if (!frame || !urls) return
    let live = true
    for (const l of frame.layers) {
      const url = urls.get(l.path)
      if (!url || imgs.has(l.path)) continue
      loadImage(url).then((img) => {
        if (live) setImgs((m) => new Map(m).set(l.path, { img, w: img.naturalWidth, h: img.naturalHeight, opacity: 1, visible: true }))
      }).catch(() => { if (live) setError('One of the pictures did not load. Check your connection.') })
    }
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, urls])

  useEffect(() => {
    const c = canvas.current; if (!c) return
    const ls: DrawLayer[] = layers.flatMap((l) => { const d = imgs.get(l.path); return d ? [{ ...d, opacity: l.opacity, visible: l.visible, x: l.x, y: l.y, scale: l.scale, rot: l.rot }] : [] })
    paintFrame(c.getContext('2d')!, c.width, c.height, ls, strokes)
  }, [layers, strokes, imgs, isDone])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  /** Leave without saving: give back files uploaded in this session that the frame does not use. */
  function close() {
    if (!saved.current && uploaded.current.length) void removeFiles(uploaded.current)
    onClose()
  }

  async function addPhoto(file: File | undefined) {
    if (!file) return
    setError(null)
    if (layers.length >= MAX_LAYERS) { setError(`A frame holds up to ${MAX_LAYERS} photo layers. Remove one first.`); return }
    setWorking('Compressing the picture')
    try {
      const { blob, w, h } = await compressImage(file)
      if (usedByOthers + bytes + blob.size > capBytes) throw new ImageProblem(`This project has reached its storyboard size limit of ${mb(capBytes)} MB. Delete a frame, or ask the owner to raise the limit.`)
      setWorking('Uploading')
      const path = await uploadImage(pid, shot.id, blob)
      uploaded.current.push(path)
      const url = URL.createObjectURL(blob)
      const img = await loadImage(url)
      setImgs((m) => new Map(m).set(path, { img, w, h, opacity: 1, visible: true }))
      setLayers((ls) => [...ls, { path, w, h, bytes: blob.size, opacity: ls.length ? 0.5 : 1, visible: true }])
    } catch (e) {
      setError(e instanceof ImageProblem ? e.message : `The picture was not uploaded. ${friendlyError(e)} Choose it again to try once more.`)
    } finally { setWorking(null) }
  }
  const patchLayer = (i: number, p: Partial<Layer>) => setLayers((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)))
  const moveLayer = (i: number, d: -1 | 1) => setLayers((ls) => { const n = [...ls]; const j = i + d; if (j < 0 || j >= n.length) return ls; [n[i], n[j]] = [n[j], n[i]]; return n })
  const dropLayer = (i: number) => setLayers((ls) => ls.filter((_, k) => k !== i))

  // ---- pen
  function pos(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!canEdit || isDone) return
    if (tool === 'move') {
      const l = layers[Math.min(sel, layers.length - 1)]
      if (!l) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const [x, y] = pos(e)
      grab.current = { x, y, lx: l.x ?? 0, ly: l.y ?? 0 }
      return
    }
    if (strokes.length >= MAX_STROKES) { setError('That is as much drawing as one frame holds. Undo or clear some strokes.'); return }
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = pos(e)
    drawing.current = { color, width: tool === 'eraser' ? width * 3 : width, points: addPoint([], x, y), ...(tool === 'eraser' ? { erase: true } : {}) }
    setStrokes((s) => [...s, drawing.current!])
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (grab.current) {
      const g = grab.current, [x, y] = pos(e), i = Math.min(sel, layers.length - 1)
      patchLayer(i, { x: Math.round((g.lx + x - g.x) * 1000) / 1000, y: Math.round((g.ly + y - g.y) * 1000) / 1000 })
      return
    }
    const cur = drawing.current; if (!cur) return
    const [x, y] = pos(e)
    const pts = addPoint(cur.points, x, y)
    if (pts === cur.points) return
    const next = { ...cur, points: pts }
    drawing.current = next
    setStrokes((s) => [...s.slice(0, -1), next])
  }
  const up = () => { drawing.current = null; grab.current = null }

  async function writeRow(patch: Partial<Frame>) {
    if (frame) {
      const { error: e } = await supabase.from('storyboard_frames').update(patch).eq('id', frame.id)
      if (e) throw e
    } else {
      const { error: e } = await supabase.from('storyboard_frames').insert({ project_id: pid, shot_id: shot.id, ...patch })
      if (e) throw e
    }
  }
  const fail = (e: unknown) => setError(/image_cap_reached/.test(String((e as { message?: string })?.message)) ? `This project has reached its storyboard size limit of ${mb(capBytes)} MB. Delete a frame, or ask the owner to raise the limit.` : friendlyError(e))

  async function save() {
    setBusy(true); setError(null)
    try {
      await writeRow({ layers, strokes, flat_path: null, done: false, bytes })
      saved.current = true
      const keep = new Set(layers.map((l) => l.path))
      await removeFiles((frame?.layers ?? []).map((l) => l.path).filter((p) => !keep.has(p)))
      onSaved(); onClose()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  async function markDone() {
    if (!layers.some((l) => l.visible) && strokes.length === 0) { setError('Add a picture or draw something first.'); return }
    setBusy(true); setError(null); setWorking('Flattening the frame')
    let flatPath: string | null = null
    try {
      const ls: DrawLayer[] = layers.flatMap((l) => { const d = imgs.get(l.path); return d ? [{ ...d, opacity: l.opacity, visible: l.visible, x: l.x, y: l.y, scale: l.scale, rot: l.rot }] : [] })
      const blob = await flatten(ls, strokes)
      if (usedByOthers + blob.size > capBytes) throw new ImageProblem(`This project has reached its storyboard size limit of ${mb(capBytes)} MB.`)
      flatPath = await uploadImage(pid, shot.id, blob)
      await writeRow({ layers: [], strokes: [], flat_path: flatPath, done: true, bytes: blob.size })
      saved.current = true
      // the layers are no longer needed: that is what frees the space
      await removeFiles([...(frame?.layers ?? []).map((l) => l.path), ...uploaded.current, ...(frame?.flat_path ? [frame.flat_path] : [])])
      onSaved(); onClose()
    } catch (e) {
      if (flatPath) void removeFiles([flatPath])
      if (e instanceof ImageProblem) setError(e.message); else fail(e)
    } finally { setBusy(false); setWorking(null) }
  }
  async function reopen() {
    if (!frame?.flat_path) return
    setBusy(true); setError(null)
    try {
      await writeRow({ layers: [{ path: frame.flat_path, w: STAGE_W, h: STAGE_H, bytes: frame.bytes, opacity: 1, visible: true }], strokes: [], flat_path: null, done: false })
      saved.current = true
      onSaved(); onClose()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  async function deleteFrame() {
    if (!frame) return
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.from('storyboard_frames').delete().eq('id', frame.id)
      if (e) throw e
      saved.current = true
      await removeFiles([...framePaths(frame), ...uploaded.current])
      onSaved(); onClose()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const used = usedByOthers + bytes
  return (
    <div className="lb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="lb-dialog lb-dialog--wide" role="dialog" aria-modal="true" aria-label={`Frame for shot ${label}`}>
        <div className="lb-spread">
          <h2 className="lb-heading" style={{ margin: 0 }}>Frame for shot {label}</h2>
          {isDone ? <Badge kind="plain"><Icon name="check" /> Done</Badge> : <Badge kind="plain">Sketch</Badge>}
        </div>
        <p className="lb-caption">{scene.heading || 'No heading yet'} · {shot.description || 'No description'}</p>

        {isDone ? (
          flatUrl ? <img className="lb-stage" src={flatUrl} alt="Finished frame" /> : <div className="lb-stage lb-stage--empty">Loading</div>
        ) : (
          <canvas ref={canvas} className="lb-stage" width={STAGE_W} height={STAGE_H} role="img" aria-label="Frame stage. Draw here with a finger, a pen or the mouse."
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ cursor: !canEdit ? 'default' : tool === 'move' ? 'move' : 'crosshair', touchAction: 'none' }} />
        )}

        {canEdit && !isDone && (
          <>
            <div className="lb-row">
              <div className="lb-seg" role="group" aria-label="Tool">
                <button type="button" aria-pressed={tool === 'pen'} aria-current={tool === 'pen' ? 'true' : undefined} onClick={() => setTool('pen')}>Pen</button>
                <button type="button" aria-pressed={tool === 'eraser'} aria-current={tool === 'eraser' ? 'true' : undefined} onClick={() => setTool('eraser')}>Eraser</button>
                <button type="button" aria-pressed={tool === 'move'} aria-current={tool === 'move' ? 'true' : undefined} disabled={!layers.length} onClick={() => setTool('move')}>Move photo</button>
              </div>
              {COLORS.map((c) => <button key={c} className="lb-swatch" aria-label={`Pen colour ${c}`} aria-pressed={color === c && tool === 'pen'} style={{ background: c }} onClick={() => { setColor(c); setTool('pen') }} />)}
              {WIDTHS.map((w) => <button key={w} className="lb-btn lb-btn--sm" aria-pressed={width === w} onClick={() => setWidth(w)}>{w === 3 ? 'Thin' : w === 6 ? 'Medium' : 'Thick'}</button>)}
              <button className="lb-btn lb-btn--sm" disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))}>Undo</button>
              <button className="lb-btn lb-btn--sm" disabled={!strokes.length} onClick={() => setStrokes([])}>Clear drawing</button>
            </div>
            <div className="lb-stack">
              <span className="lb-label" style={{ padding: 0 }}>Photo layers ({layers.length} of {MAX_LAYERS})</span>
              {layers.length === 0 && <p className="lb-caption">No photos yet. Add a picture, then draw over it. Each extra photo sits on top of the one before and can be made see-through.</p>}
              {layers.map((l, i) => (
                <div key={l.path} className="lb-layer">
                  <button type="button" className="lb-btn lb-btn--sm" aria-pressed={tool === 'move' && Math.min(sel, layers.length - 1) === i} onClick={() => { setSel(i); setTool('move') }}>Layer {i + 1}{tool === 'move' && Math.min(sel, layers.length - 1) === i ? ' (moving)' : ''}</button>
                  <span className="lb-caption">{Math.round(l.bytes / 1024)} KB</span>
                  <label className="lb-row"><input type="checkbox" checked={l.visible} onChange={(e) => patchLayer(i, { visible: e.target.checked })} /> Show</label>
                  <label className="lb-row">See-through <input type="range" min={10} max={100} step={5} value={Math.round(l.opacity * 100)} aria-label={`Opacity of layer ${i + 1}`} onChange={(e) => patchLayer(i, { opacity: Number(e.target.value) / 100 })} /></label>
                  <label className="lb-row">Size <input type="range" min={20} max={300} step={5} value={Math.round((l.scale ?? 1) * 100)} aria-label={`Size of layer ${i + 1}`} onChange={(e) => patchLayer(i, { scale: Number(e.target.value) / 100 })} /></label>
                  <label className="lb-row">Turn <input type="range" min={-180} max={180} step={5} value={l.rot ?? 0} aria-label={`Rotation of layer ${i + 1}`} onChange={(e) => patchLayer(i, { rot: Number(e.target.value) })} /></label>
                  <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" disabled={!l.x && !l.y && !l.rot && (l.scale ?? 1) === 1} onClick={() => patchLayer(i, { x: 0, y: 0, rot: 0, scale: 1 })}>Reset</button>
                  <span className="lb-row">
                    <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Move layer ${i + 1} down`} disabled={i === 0} onClick={() => moveLayer(i, -1)}>↓</button>
                    <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Move layer ${i + 1} up`} disabled={i === layers.length - 1} onClick={() => moveLayer(i, 1)}>↑</button>
                    <button className="lb-btn lb-btn--sm" onClick={() => dropLayer(i)}>Remove</button>
                  </span>
                </div>
              ))}
              <div className="lb-row">
                <input id="sb-file" type="file" accept="image/*" className="lb-input" style={{ maxWidth: 320 }} disabled={busy || Boolean(working) || layers.length >= MAX_LAYERS}
                  onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = '' }} aria-label="Add a photo layer" />
                {working && <span className="lb-caption" role="status">{working}…</span>}
              </div>
            </div>
          </>
        )}
        {!canEdit && <p className="lb-caption"><Icon name="lock" /> Only the team that owns this shot can change its frame.</p>}
        <p className="lb-caption">This project uses {mb(used)} MB of {mb(capBytes)} MB for storyboard pictures. Marking a frame done flattens it into one picture and frees the space the layers used.</p>
        {error && <p className="lb-error" role="alert">{error}</p>}
        <div className="lb-actions" style={{ justifyContent: 'space-between' }}>
          <span className="lb-row">{canEdit && frame && <button className="lb-btn lb-btn--danger" disabled={busy} onClick={deleteFrame}>Delete frame</button>}</span>
          <span className="lb-row">
            <button className="lb-btn" onClick={close}>Close</button>
            {canEdit && isDone && <button className="lb-btn lb-btn--primary" disabled={busy} onClick={reopen}>Reopen to edit</button>}
            {canEdit && !isDone && <button className="lb-btn" disabled={busy || Boolean(working)} onClick={save}>Save sketch</button>}
            {canEdit && !isDone && <button className="lb-btn lb-btn--primary" disabled={busy || Boolean(working)} onClick={markDone}><Icon name="check" /> Mark done</button>}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Storyboard() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const online = useOnline()
  const scenes = useScenes(pid).data ?? []
  const shots = useShots(pid).data ?? []
  const framesQ = useFrames(pid)
  const frames = useMemo(() => framesQ.data ?? new Map<string, Frame>(), [framesQ.data])
  const paths = useMemo(() => [...frames.values()].flatMap(framePaths), [frames])
  const urls = useSignedUrls(paths).data
  const def = SECTIONS.find((s) => s.path === 'storyboard')!
  const st = navState(b, def)
  const level = levelFor(b, 'shots')
  const [open, setOpen] = useState<string | null>(null)
  const [capEdit, setCapEdit] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const capMb = b.project.image_cap_mb ?? 200
  const used = totalBytes(frames.values())
  const pct = Math.min(100, (used / (capMb * 1048576)) * 100)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['frames', pid] }); void qc.invalidateQueries({ queryKey: ['signed'] }) }

  const bySceneId = useMemo(() => {
    const m = new Map<string, Shot[]>()
    for (const s of shots) m.set(s.scene_id, [...(m.get(s.scene_id) ?? []), s])
    return m
  }, [shots])

  async function saveCap() {
    const n = Number(capEdit)
    if (!Number.isFinite(n) || n < 10 || n > 5000) { setError('Choose a limit between 10 and 5000 MB.'); return }
    setError(null)
    const { error: e } = await supabase.from('projects').update({ image_cap_mb: Math.round(n) }).eq('id', pid)
    if (e) { setError(friendlyError(e)); return }
    setCapEdit(null); void qc.invalidateQueries({ queryKey: ['project', pid] })
  }

  async function exportPdf() {
    setExporting(true); setError(null)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
      const cells = gridCells(842, 595, 36, 3, 2, 14)
      const all = scenes.flatMap((sc, si) => (bySceneId.get(sc.id) ?? []).map((s, i) => ({ sc, si, s, n: i + 1 })))
      const u = new Map<string, string>()
      if (paths.length) {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600)
        for (const d of data ?? []) u.set(d.path ?? '', d.signedUrl ?? '')
      }
      for (let i = 0; i < all.length; i++) {
        if (i > 0 && i % 6 === 0) doc.addPage()
        const cell = cells[i % 6]
        const { sc, si, s, n } = all[i]
        const f = frames.get(s.id)
        const imgH = cell.h - 34
        doc.setDrawColor(190); doc.rect(cell.x, cell.y, cell.w, imgH)
        if (f) {
          try {
            const ls: DrawLayer[] = f.done ? [] : await Promise.all(f.layers.map(async (l) => { const im = await loadImage(u.get(l.path) ?? ''); return toDraw(l, im, im.naturalWidth, im.naturalHeight) }))
            const c = document.createElement('canvas'); c.width = 960; c.height = 540
            const ctx = c.getContext('2d')!
            if (f.done && f.flat_path) { const im = await loadImage(u.get(f.flat_path) ?? ''); ctx.drawImage(im, 0, 0, 960, 540) } else paintFrame(ctx, 960, 540, ls, f.strokes)
            const ratio = 16 / 9
            const w = Math.min(cell.w, imgH * ratio), h = w / ratio
            doc.addImage(c.toDataURL('image/jpeg', 0.8), 'JPEG', cell.x + (cell.w - w) / 2, cell.y + (imgH - h) / 2, w, h)
          } catch { doc.setFontSize(9); doc.text('Picture not available', cell.x + 8, cell.y + 16) }
        } else { doc.setFontSize(9); doc.setTextColor(140); doc.text('No frame', cell.x + 8, cell.y + 16); doc.setTextColor(0) }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(shotLabel(sc, si, n), cell.x, cell.y + imgH + 13)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
        doc.text(doc.splitTextToSize([s.description, s.size].filter(Boolean).join(' · ') || ' ', cell.w - 34)[0] ?? '', cell.x + 34, cell.y + imgH + 13)
      }
      if (!all.length) doc.text('No shots yet.', 40, 60)
      const blob = doc.output('blob')
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(b.project.name.replace(/[^\w-]+/g, '_') || 'storyboard')}-storyboard.pdf`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) { setError(friendlyError(e)) } finally { setExporting(false) }
  }

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">Storyboard</h1>
      {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={level === 'edit' ? 'edit' : 'view'} />}
    </div>
  )
  if (st.locked) {
    return (
      <>
        {head}
        <EmptyState title="The storyboard is not open to your team" action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>
          The owner can change this in Team and access.
        </EmptyState>
      </>
    )
  }

  const openShot = open ? shots.find((s) => s.id === open) : undefined
  const openScene = openShot ? scenes.find((s) => s.id === openShot.scene_id) : undefined
  return (
    <>
      {head}
      <p className="lb-caption">One frame for each shot. Add up to {MAX_LAYERS} photos, draw over them, and mark the frame done to flatten it into one picture. Frames belong to the shot's team.</p>
      {!online && <Banner lead="Offline">Frames are blank without a connection. Export the storyboard as a PDF before you go somewhere with no signal.</Banner>}
      <div className="lb-row">
        <span className="lb-caption"><b>{mb(used)} MB</b> of {capMb} MB used</span>
        <span className="lb-meter" role="img" aria-label={`${Math.round(pct)} percent of the storyboard size limit used`}><span style={{ width: `${pct}%` }} /></span>
        {pct >= 90 && <Badge kind="conflict"><Icon name="warn" /> Nearly full</Badge>}
        {isOwnerOrAdmin(b) && capEdit === null && <button className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => setCapEdit(String(capMb))}>Change limit</button>}
        {capEdit !== null && (
          <span className="lb-row">
            <input className="lb-input" style={{ width: 110, minHeight: 36 }} type="number" min={10} max={5000} value={capEdit} aria-label="Size limit in MB" onChange={(e) => setCapEdit(e.target.value)} />
            <button className="lb-btn lb-btn--sm" onClick={saveCap}>Save limit</button>
            <button className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => setCapEdit(null)}>Cancel</button>
          </span>
        )}
        <span className="lb-grow" />
        <button className="lb-btn" disabled={exporting || !shots.length} onClick={exportPdf}>{exporting ? 'Making the PDF' : 'Export storyboard PDF'}</button>
      </div>
      {error && <p className="lb-error" role="alert">{error}</p>}
      {!shots.length && <EmptyState title="No shots yet" action={<Link className="lb-btn" to="../shots">Open the Shot list</Link>}>Frames belong to shots. Add shots in the shot list first.</EmptyState>}

      <div className="lb-sheet lb-boards">
        {scenes.map((sc, si) => {
          const list = bySceneId.get(sc.id) ?? []
          if (!list.length) return null
          return (
            <section key={sc.id} className="lb-shotscene" aria-label={`Scene ${sc.display_number ?? si + 1}`}>
              <header className="lb-shotscene-head">
                <SceneChip n={sc.display_number} position={si + 1} omitted={sc.status === 'omitted'} />
                <h2 className="lb-sp-h">{sc.heading || <span className="lb-muted">No heading yet</span>}</h2>
              </header>
              <div className="lb-grid">
                {list.map((s, i) => {
                  const f = frames.get(s.id)
                  const editable = canEditShotsFor(b, s.team_id)
                  return (
                    <button key={s.id} className="lb-card-btn" onClick={() => setOpen(s.id)} aria-label={`Open the frame for shot ${shotLabel(sc, si, i + 1)}`}>
                      <FrameThumb frame={f} urls={urls} offline={!online} />
                      <span className="lb-card-cap">
                        <span className="lb-body-strong">{shotLabel(sc, si, i + 1)}</span>
                        <span className="lb-card-desc">{s.description || 'No description'}</span>
                        <span className="lb-caption">
                          {f?.done ? <><Icon name="check" /> Done</> : f ? 'Sketch' : editable ? 'Add a frame' : <><Icon name="lock" /> No frame</>}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {openShot && openScene && (
        <FrameEditor
          key={openShot.id + (frames.get(openShot.id)?.updated_at ?? '')}
          shot={openShot} scene={openScene}
          label={shotLabel(openScene, scenes.findIndex((s) => s.id === openScene.id), (bySceneId.get(openScene.id) ?? []).findIndex((s) => s.id === openShot.id) + 1)}
          frame={frames.get(openShot.id)} canEdit={canEditShotsFor(b, openShot.team_id)} urls={urls}
          usedByOthers={used - (frames.get(openShot.id)?.bytes ?? 0)} capBytes={capMb * 1048576} pid={pid}
          onClose={() => setOpen(null)} onSaved={refresh}
        />
      )}
    </>
  )
}
