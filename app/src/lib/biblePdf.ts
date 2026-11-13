import type { BibleFormat, MoodItem } from './bible'
import { MOOD_BUCKET } from './bible'
import { loadImage } from './storyboard'
import { supabase } from './supabase'
import { fileSafe } from './reportPdf'

export const bibleFileName = (project: string) => fileSafe(project) + '-project-bible'

/** The Project bible as an A4 PDF: the format facts, then the moodboard cards two across with their pictures. */
export async function buildBiblePdf(opts: { project: string; ratio: string; format: BibleFormat | null; items: MoodItem[]; withMoodboard: boolean }): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const M = 14, usable = W - 2 * M
  let y = M
  const need = (h: number) => { if (y + h > H - 16) { doc.addPage(); y = M } }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Project bible', M, y + 6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(new Date().toLocaleDateString(), W - M, y + 4, { align: 'right' })
  y += 11
  doc.setFontSize(11); doc.text(opts.project, M, y); y += 3
  doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 6

  // ---- Format
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Format', M, y); y += 6
  const f = opts.format
  const facts: [string, string][] = [
    ['Aspect ratio', opts.ratio], ['Frame rate', f?.frame_rate ? f.frame_rate + ' fps' : ''], ['Resolution', f?.resolution ?? ''],
    ['Camera format', f?.camera_format ?? ''], ['Delivery', f?.delivery ?? ''],
  ]
  for (const [k, v] of facts) {
    need(7)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(k.toUpperCase(), M, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.text(v || '–', M + 42, y)
    doc.setDrawColor(210); doc.setLineWidth(0.1); doc.line(M, y + 2, W - M, y + 2); y += 7
  }
  for (const [k, v] of [['Colour and look', f?.look_notes ?? ''], ['Notes', f?.notes ?? '']] as [string, string][]) {
    if (!v.trim()) continue
    y += 2; need(14)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(k.toUpperCase(), M, y); y += 4.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    for (const line of doc.splitTextToSize(v, usable) as string[]) { need(5); doc.text(line, M, y); y += 4.6 }
  }

  // ---- Moodboard
  if (opts.withMoodboard) {
    y += 6; need(20)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Moodboard', M, y); y += 6
    if (opts.items.length === 0) { doc.setFont('helvetica', 'italic'); doc.setFontSize(9.5); doc.text('Nothing on the moodboard yet.', M, y); y += 6 }
    const paths = opts.items.flatMap((i) => (i.image_path ? [i.image_path] : []))
    const urls = new Map<string, string>()
    if (paths.length) {
      const { data } = await supabase.storage.from(MOOD_BUCKET).createSignedUrls(paths, 600)
      for (const d of data ?? []) urls.set(d.path ?? '', d.signedUrl ?? '')
    }
    const gap = 6, cw = (usable - gap) / 2, imgH = 52
    for (let i = 0; i < opts.items.length; i += 2) {
      const pair = opts.items.slice(i, i + 2)
      // measure the tallest text in this row so the row stays together
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      const descs = pair.map((it) => (doc.splitTextToSize(it.description || '', cw) as string[]).slice(0, it.kind === 'text' ? 18 : 6))
      const textH = Math.max(...descs.map((d) => d.length)) * 3.8
      need(imgH + 12 + textH)
      for (let c = 0; c < pair.length; c++) {
        const it = pair[c]; const x = M + c * (cw + gap)
        doc.setDrawColor(190); doc.setLineWidth(0.15); doc.rect(x, y, cw, imgH)
        if (it.kind === 'image') {
          try {
            const im = await loadImage(urls.get(it.image_path ?? '') ?? '')
            const k = Math.min(cw / im.naturalWidth, imgH / im.naturalHeight)
            const w = im.naturalWidth * k, h = im.naturalHeight * k
            const cv = document.createElement('canvas'); const sc = Math.min(1, 900 / Math.max(im.naturalWidth, im.naturalHeight))
            cv.width = Math.max(1, Math.round(im.naturalWidth * sc)); cv.height = Math.max(1, Math.round(im.naturalHeight * sc))
            const ctx = cv.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0, cv.width, cv.height)
            doc.addImage(cv.toDataURL('image/jpeg', 0.82), 'JPEG', x + (cw - w) / 2, y + (imgH - h) / 2, w, h)
          } catch { doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.text('Picture not available', x + 3, y + 6) }
        } else {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
          const lines = (doc.splitTextToSize(it.description || it.caption || '', cw - 6) as string[]).slice(0, 12)
          lines.forEach((l, n) => doc.text(l, x + 3, y + 6 + n * 4.2))
        }
        let ty = y + imgH + 5
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
        doc.text((doc.splitTextToSize(it.caption || (it.kind === 'image' ? 'Untitled picture' : 'Note'), cw) as string[])[0], x, ty); ty += 4.2
        if (it.kind === 'image') { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); descs[c].forEach((l) => { doc.text(l, x, ty); ty += 3.8 }) }
      }
      y += imgH + 12 + (pair.some((p) => p.kind === 'image') ? textH : 0)
    }
  }

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(`${opts.project} · Project bible · page ${p} of ${pages}`, M, H - 8) }
  return doc.output('blob')
}
