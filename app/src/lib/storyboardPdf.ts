import { gridCells, drawContain, loadImage, paintFrame, toDraw, BUCKET, type DrawLayer, type Frame } from './storyboard'
import { ratioValue, stageSize } from './aspect'
import { shotLabel, type Shot } from './shots'
import { supabase } from './supabase'
import type { Scene } from './types'

/** The storyboard PDF: A4 landscape, six frames a page, each with its shot number and description. */
export async function buildStoryboardPdf({ scenes, bySceneId, frames, ratio, paths }: {
  scenes: Scene[]; bySceneId: Map<string, Shot[]>; frames: Map<string, Frame>; ratio: string; paths: string[]
}): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const cells = gridCells(842, 595, 36, 3, 2, 14)
  const pdfSz = stageSize(ratio); const pdfW = Math.round(pdfSz.w * 0.75), pdfH = Math.round(pdfSz.h * 0.75)
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
        const c = document.createElement('canvas'); c.width = pdfW; c.height = pdfH
        const ctx = c.getContext('2d')!
        if (f.done && f.flat_path) { const im = await loadImage(u.get(f.flat_path) ?? ''); drawContain(ctx, im, pdfW, pdfH) } else paintFrame(ctx, pdfW, pdfH, ls, f.strokes)
        const rv = ratioValue(ratio)
        const w = Math.min(cell.w, imgH * rv), h = w / rv
        doc.addImage(c.toDataURL('image/jpeg', 0.8), 'JPEG', cell.x + (cell.w - w) / 2, cell.y + (imgH - h) / 2, w, h)
      } catch { doc.setFontSize(9); doc.text('Picture not available', cell.x + 8, cell.y + 16) }
    } else { doc.setFontSize(9); doc.setTextColor(140); doc.text('No frame', cell.x + 8, cell.y + 16); doc.setTextColor(0) }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(shotLabel(sc, si, n), cell.x, cell.y + imgH + 13)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(doc.splitTextToSize([s.description, s.size].filter(Boolean).join(' · ') || ' ', cell.w - 34)[0] ?? '', cell.x + 34, cell.y + imgH + 13)
  }
  if (!all.length) doc.text('No shots yet.', 40, 60)
  return doc.output('blob')
}
