import { useEffect, useRef, useState } from 'react'
import { Badge, Icon } from './ui'
import { friendlyError } from '../lib/errors'
import { PEN_COLORS, PEN_DEFAULT } from '../lib/penColors'
import { type Shot } from '../lib/shots'
import {
  ImageProblem, MAX_LAYERS, MAX_STROKES, addPoint, compressImage, flatten, framePaths, loadImage, mb, paintFrame, removeFiles, uploadImage,
  type DrawLayer, type Frame, type Layer, type Stroke,
} from '../lib/storyboard'
import { supabase } from '../lib/supabase'
import { cssRatio, stageSize } from '../lib/aspect'
import type { Scene } from '../lib/types'

const WIDTHS = [3, 6, 12]

interface EditorProps {
  shot: Shot; scene: Scene; frame: Frame | undefined; canEdit: boolean
  urls: Map<string, string> | undefined; usedByOthers: number; capBytes: number; showUsage: boolean
  pid: string; ratio: string; onClose: () => void; onSaved: () => void
  /** The dialog around the editor calls this to close it the right way (it gives back files uploaded in the session). */
  closeRef?: { current: (() => void) | null }
}

export function FrameEditor({ shot, scene, frame, canEdit, urls, usedByOthers, capBytes, showUsage, pid, ratio, onClose, onSaved, closeRef }: EditorProps) {
  const stage = stageSize(ratio)
  const [layers, setLayers] = useState<Layer[]>(frame?.layers ?? [])
  const [strokes, setStrokes] = useState<Stroke[]>(frame?.strokes ?? [])
  const [color, setColor] = useState(PEN_DEFAULT)
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

  /** Leave without saving: give back files uploaded in this session that the frame does not use. */
  function close() {
    if (!saved.current && uploaded.current.length) void removeFiles(uploaded.current)
    onClose()
  }
  useEffect(() => { if (closeRef) closeRef.current = close })

  async function addPhoto(file: File | undefined) {
    if (!file) return
    setError(null)
    if (layers.length >= MAX_LAYERS) { setError(`A frame holds up to ${MAX_LAYERS} photo layers. Remove one first.`); return }
    setWorking('Compressing the picture')
    try {
      const { blob, w, h } = await compressImage(file)
      if (usedByOthers + bytes + blob.size > capBytes) throw new ImageProblem(`This project has reached its storyboard size limit of ${mb(capBytes)} MB. Delete a frame, or ask the admin to raise the limit.`)
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
  const fail = (e: unknown) => setError(/image_cap_reached/.test(String((e as { message?: string })?.message)) ? `This project has reached its storyboard size limit of ${mb(capBytes)} MB. Delete a frame, or ask the admin to raise the limit.` : friendlyError(e))

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
      const blob = await flatten(ls, strokes, ratio)
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
      let fw = stage.w, fh = stage.h
      try { const im = await loadImage(urls?.get(frame.flat_path) ?? ''); fw = im.naturalWidth || fw; fh = im.naturalHeight || fh } catch { /* keep the stage size */ }
      await writeRow({ layers: [{ path: frame.flat_path, w: fw, h: fh, bytes: frame.bytes, opacity: 1, visible: true }], strokes: [], flat_path: null, done: false })
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
    <>
        <div className="lb-spread">
          <span className="lb-caption">{scene.heading || 'No heading yet'} · {shot.description || 'No description'}</span>
          {isDone ? <Badge kind="plain"><Icon name="check" /> Done</Badge> : <Badge kind="plain">Sketch</Badge>}
        </div>

        {isDone ? (
          flatUrl ? <img className="lb-stage" style={{ aspectRatio: cssRatio(ratio), objectFit: 'contain' }} src={flatUrl} alt="Finished frame" /> : <div className="lb-stage lb-stage--empty" style={{ aspectRatio: cssRatio(ratio) }}>Loading</div>
        ) : (
          <canvas ref={canvas} className="lb-stage" width={stage.w} height={stage.h} role="img" aria-label="Frame stage. Draw here with a finger, a pen or the mouse."
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ aspectRatio: cssRatio(ratio), cursor: !canEdit ? 'default' : tool === 'move' ? 'move' : 'crosshair', touchAction: 'none' }} />
        )}

        {canEdit && !isDone && (
          <>
            <div className="lb-row">
              <div className="lb-seg" role="group" aria-label="Tool">
                <button type="button" aria-pressed={tool === 'pen'} aria-current={tool === 'pen' ? 'true' : undefined} onClick={() => setTool('pen')}>Pen</button>
                <button type="button" aria-pressed={tool === 'eraser'} aria-current={tool === 'eraser' ? 'true' : undefined} onClick={() => setTool('eraser')}>Eraser</button>
                <button type="button" aria-pressed={tool === 'move'} aria-current={tool === 'move' ? 'true' : undefined} disabled={!layers.length} onClick={() => setTool('move')}>Move photo</button>
              </div>
              {PEN_COLORS.map((c) => <button key={c} className="lb-swatch" aria-label={`Pen colour ${c}`} aria-pressed={color === c && tool === 'pen'} style={{ background: c }} onClick={() => { setColor(c); setTool('pen') }} />)}
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
        <p className="lb-caption">{showUsage ? `This project uses ${mb(used)} MB of ${mb(capBytes)} MB for storyboard pictures. ` : ''}Marking a frame done flattens it into one picture and frees the space the layers used.</p>
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
    </>
  )
}
