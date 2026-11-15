import { useEffect, useRef, useState } from 'react'
import { MAX_STROKES, addPoint, paintFrame, type Stroke } from '../lib/storyboard'
import { Dialog, Icon } from './ui'

const COLORS = ['#d7140f', '#111111', '#1f5fd1', '#f2b33d']
const WIDTHS = [3, 6, 12]

/** The pen strokes of a photo, drawn on a transparent canvas laid over the picture (the photo file is never changed). */
export function StrokeOverlay({ strokes, className }: { strokes: Stroke[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    paintFrame(ctx, c.width, c.height, [], strokes, false)
  }, [strokes])
  return <canvas ref={ref} width={640} height={480} className={className ?? 'lb-strokes'} aria-hidden="true" />
}

/** A photo with its drawing. The canvas stretches to the photo's shape, so points stay in place at any size. */
export function PhotoWithDrawing({ url, strokes, alt }: { url: string; strokes: Stroke[]; alt: string }) {
  return (
    <span className="lb-photo">
      <img src={url} alt={alt} loading="lazy" />
      {strokes.length > 0 && <StrokeOverlay strokes={strokes} />}
    </span>
  )
}

/** Draw on a location photo: pen, three colours and widths, eraser, undo, clear. Saves only the strokes. */
export default function PhotoDraw({ url, strokes: initial, canEdit, busy, error, onSave, onClose }: {
  url: string; strokes: Stroke[]; canEdit: boolean; busy: boolean; error: string | null; onSave: (s: Stroke[]) => void; onClose: () => void
}) {
  const [strokes, setStrokes] = useState<Stroke[]>(initial)
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<Stroke | null>(null)

  // the canvas takes the photo's own pixel shape, so strokes (0 to 1) land on the same spot at any display size
  useEffect(() => {
    const img = new Image()
    img.onload = () => { const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)); setSize({ w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) }) }
    img.src = url
  }, [url])
  useEffect(() => {
    const c = canvas.current; if (!c || !size) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    paintFrame(ctx, c.width, c.height, [], strokes, false)
  }, [strokes, size])

  function pos(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!canEdit) return
    if (strokes.length >= MAX_STROKES) { setNote('That is as much drawing as one photo holds. Undo or clear some strokes.'); return }
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = pos(e)
    drawing.current = { color, width: tool === 'eraser' ? width * 3 : width, points: addPoint([], x, y), ...(tool === 'eraser' ? { erase: true } : {}) }
    setStrokes((s) => [...s, drawing.current!])
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const cur = drawing.current; if (!cur) return
    const [x, y] = pos(e)
    const pts = addPoint(cur.points, x, y)
    if (pts === cur.points) return
    const next = { ...cur, points: pts }
    drawing.current = next
    setStrokes((s) => [...s.slice(0, -1), next])
  }
  const up = () => { drawing.current = null }
  const changed = JSON.stringify(strokes) !== JSON.stringify(initial)

  return (
    <Dialog title={canEdit ? 'Draw on the photo' : 'Photo'} wide onClose={onClose}>
      {canEdit && (
        <div className="lb-row" role="toolbar" aria-label="Drawing tools">
          <div className="lb-seg" role="group" aria-label="Tool">
            <button type="button" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>Pen</button>
            <button type="button" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>Eraser</button>
          </div>
          <span className="lb-row" role="group" aria-label="Colour" style={{ gap: 6 }}>
            {COLORS.map((c) => <button key={c} type="button" className={'lb-swatch' + (color === c && tool === 'pen' ? ' is-on' : '')} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => { setColor(c); setTool('pen') }} />)}
          </span>
          <div className="lb-seg" role="group" aria-label="Width">
            {WIDTHS.map((w, i) => <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)}>{['Thin', 'Medium', 'Thick'][i]}</button>)}
          </div>
          <button type="button" className="lb-btn lb-btn--sm" disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))}>Undo</button>
          <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" disabled={!strokes.length} onClick={() => setStrokes([])}>Clear</button>
        </div>
      )}
      <div className="lb-drawstage">
        <img src={url} alt="" draggable={false} />
        {size && <canvas ref={canvas} width={size.w} height={size.h} className="lb-strokes lb-strokes--live" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Drawing area" />}
      </div>
      {(error || note) && <p className="lb-error" role="alert">{error ?? note}</p>}
      <div className="lb-actions">
        <button className="lb-btn" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
        {canEdit && <button className="lb-btn lb-btn--primary" disabled={busy || !changed} onClick={() => onSave(strokes)}>{busy ? 'Saving' : 'Save drawing'}</button>}
      </div>
      <p className="lb-caption lb-phone-hide"><Icon name="pencil" /> The drawing sits on top of the photo. The photo itself is never changed.</p>
    </Dialog>
  )
}
