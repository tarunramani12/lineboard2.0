import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { DEFAULT_ASPECT, stageSize } from './aspect'

export const BUCKET = 'storyboard'
export const MAX_LAYERS = 4
export const MAX_STROKES = 600
export const STAGE_W = 1280
export const STAGE_H = 720
export const MAX_INPUT_BYTES = 25 * 1024 * 1024        // a photo from the camera roll
export const TARGET_BYTES = 450 * 1024                  // after compression

/** x and y shift the picture as a share of the stage (0 = centred), scale is 1 for fitted, rot is degrees. All optional. */
export interface Placement { x?: number; y?: number; scale?: number; rot?: number }
export interface Layer extends Placement { path: string; w: number; h: number; bytes: number; opacity: number; visible: boolean }
export interface Stroke { color: string; width: number; points: [number, number][]; erase?: boolean }
export interface Frame {
  id: string; project_id: string; shot_id: string; layers: Layer[]; strokes: Stroke[]
  flat_path: string | null; done: boolean; bytes: number; updated_by: string | null; updated_at: string
}

export function useFrames(pid: string | undefined) {
  return useQuery({
    queryKey: ['frames', pid],
    enabled: Boolean(pid),
    queryFn: async () => {
      const { data, error } = await supabase.from('storyboard_frames').select('*').eq('project_id', pid!)
      if (error) throw error
      return new Map((data as Frame[]).map((f) => [f.shot_id, f]))
    },
  })
}

export const totalBytes = (frames: Iterable<Frame>) => { let n = 0; for (const f of frames) n += f.bytes; return n }
export const mb = (bytes: number) => (bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)
export const framePaths = (f: Frame): string[] => [...f.layers.map((l) => l.path), ...(f.flat_path ? [f.flat_path] : [])]

/** Signed links for private files, valid for an hour. */
export function useSignedUrls(paths: string[]) {
  const key = [...paths].sort().join('|')
  return useQuery({
    queryKey: ['signed', key],
    enabled: paths.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      if (error) throw error
      return new Map(data.map((d) => [d.path ?? '', d.signedUrl ?? '']))
    },
  })
}

// ---- Images in the browser -------------------------------------------------------------------

export class ImageProblem extends Error {}

async function decode(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; close?: () => void }> {
  if ('createImageBitmap' in window) {
    try { const bmp = await createImageBitmap(file); return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() } } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new ImageProblem('This file could not be read as a picture.')); i.src = url })
    return { img, w: img.naturalWidth, h: img.naturalHeight }
  } finally { URL.revokeObjectURL(url) }
}

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new ImageProblem('The picture could not be compressed.'))), 'image/jpeg', q))

/** Shrink a photo to at most 1280 pixels on the long side and save it as a JPEG of about 450 KB or less. */
export async function compressImage(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  if (!file.type.startsWith('image/')) throw new ImageProblem('That file is not a picture. Choose a JPEG, PNG or similar.')
  if (file.size > MAX_INPUT_BYTES) throw new ImageProblem(`That picture is ${mb(file.size)} MB. The limit before compression is ${mb(MAX_INPUT_BYTES)} MB.`)
  const d = await decode(file)
  try {
    const scale = Math.min(1, STAGE_W / Math.max(d.w, d.h))
    const w = Math.max(1, Math.round(d.w * scale)), h = Math.max(1, Math.round(d.h * scale))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(d.img, 0, 0, w, h)
    let q = 0.78, blob = await toBlob(c, q)
    while (blob.size > TARGET_BYTES && q > 0.45) { q -= 0.1; blob = await toBlob(c, q) }
    return { blob, w, h }
  } finally { d.close?.() }
}

export async function uploadImage(pid: string, shotId: string, blob: Blob): Promise<string> {
  const path = `${pid}/${shotId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}
export async function removeFiles(paths: string[]) {
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
}

/** Delete every file under a folder of the bucket (a project, or one shot). */
export async function removeFolder(prefix: string): Promise<void> {
  const { data } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 })
  const files = (data ?? []).filter((x) => x.id).map((x) => `${prefix}/${x.name}`)
  const dirs = (data ?? []).filter((x) => !x.id).map((x) => `${prefix}/${x.name}`)
  if (files.length) await supabase.storage.from(BUCKET).remove(files)
  for (const d of dirs) await removeFolder(d)
}

const cache = new Map<string, Promise<HTMLImageElement>>()
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = cache.get(url)
  if (!p) {
    p = new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => { cache.delete(url); rej(new Error('image')) }; i.src = url })
    cache.set(url, p)
  }
  return p
}

// ---- Drawing and flattening -------------------------------------------------------------------

export interface DrawLayer extends Placement { img: CanvasImageSource; w: number; h: number; opacity: number; visible: boolean }

/** A layer as stored, plus its loaded picture, ready to paint. */
export const toDraw = (l: Layer, img: CanvasImageSource, w: number, h: number): DrawLayer =>
  ({ img, w, h, opacity: l.opacity, visible: l.visible, x: l.x, y: l.y, scale: l.scale, rot: l.rot })

/** Paint the photo layers (fitted, moved, sized and turned as set, in order, each with its opacity) and then the pen strokes. The eraser only rubs out pen strokes. */
export function paintFrame(ctx: CanvasRenderingContext2D, W: number, H: number, layers: DrawLayer[], strokes: Stroke[]) {
  ctx.save()
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  for (const l of layers) {
    if (!l.visible) continue
    const s = Math.min(W / l.w, H / l.h) * (l.scale ?? 1)
    ctx.save()
    ctx.globalAlpha = l.opacity
    ctx.translate(W / 2 + (l.x ?? 0) * W, H / 2 + (l.y ?? 0) * H)
    ctx.rotate(((l.rot ?? 0) * Math.PI) / 180)
    ctx.drawImage(l.img, (-l.w * s) / 2, (-l.h * s) / 2, l.w * s, l.h * s)
    ctx.restore()
  }
  if (strokes.length) {
    const ink = typeof document !== 'undefined' ? document.createElement('canvas') : null
    const target = ink ? ink.getContext('2d')! : ctx
    if (ink) { ink.width = W; ink.height = H }
    target.lineCap = 'round'; target.lineJoin = 'round'
    for (const s of strokes) {
      if (!s.points.length) continue
      target.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
      target.strokeStyle = s.erase ? '#000' : s.color; target.lineWidth = s.width * (Math.max(W, H) / STAGE_W)
      target.beginPath()
      target.moveTo(s.points[0][0] * W, s.points[0][1] * H)
      if (s.points.length === 1) target.lineTo(s.points[0][0] * W + 0.1, s.points[0][1] * H)
      for (const p of s.points.slice(1)) target.lineTo(p[0] * W, p[1] * H)
      target.stroke()
    }
    target.globalCompositeOperation = 'source-over'
    if (ink) ctx.drawImage(ink, 0, 0)
  }
  ctx.restore()
}

export async function flatten(layers: DrawLayer[], strokes: Stroke[], ratio: string = DEFAULT_ASPECT, quality = 0.82): Promise<Blob> {
  const { w, h } = stageSize(ratio)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  paintFrame(c.getContext('2d')!, w, h, layers, strokes)
  return toBlob(c, quality)
}

/** Draw a finished picture inside a canvas without stretching it (a frame made at another ratio is centred). */
export function drawContain(ctx: CanvasRenderingContext2D, im: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength }, W: number, H: number) {
  const iw = im.naturalWidth || Number(im.width) || W, ih = im.naturalHeight || Number(im.height) || H
  const k = Math.min(W / iw, H / ih)
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.drawImage(im, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k)
}

/** Keep strokes small: three decimals, and drop points that sit almost on top of the last one. */
export function addPoint(points: [number, number][], x: number, y: number): [number, number][] {
  const p: [number, number] = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]
  const last = points[points.length - 1]
  if (last && Math.abs(last[0] - p[0]) < 0.0015 && Math.abs(last[1] - p[1]) < 0.0015) return points
  return [...points, p]
}

/** A paper-friendly grid: positions of frames on a landscape page, cols across and rows down. */
export function gridCells(pageW: number, pageH: number, margin: number, cols: number, rows: number, gap: number) {
  const cw = (pageW - margin * 2 - gap * (cols - 1)) / cols
  const ch = (pageH - margin * 2 - gap * (rows - 1)) / rows
  const cells: { x: number; y: number; w: number; h: number }[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: margin + c * (cw + gap), y: margin + r * (ch + gap), w: cw, h: ch })
  return cells
}
