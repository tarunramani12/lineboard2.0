import type { SheetDiff, SheetSnapshot } from './callsheets'
import { formatDate } from './schedule'

export interface PdfOptions { size: 'a4' | 'letter'; rev: number; sentBy: string; sentAt: string | null; diff: SheetDiff; draft?: boolean }

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/** A plain, printable call sheet. Black on white, changed lines carry a star, and it is made for A4. */
export async function callSheetPdf(s: SheetSnapshot, o: PdfOptions): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: o.size })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const M = 14, right = W - M, usable = W - 2 * M
  let y = M
  const star = (k: string) => (o.diff.changed.has(k) ? '* ' : '')
  const fit = (t: string, w: number) => doc.splitTextToSize(t || '', w) as string[]
  const need = (h: number) => { if (y + h > H - 16) { doc.addPage(); y = M } }
  const rule = () => { doc.setDrawColor(0); doc.setLineWidth(0.2); doc.line(M, y, right, y); y += 2 }
  const heading = (t: string) => { need(16); y += 6; doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(t.toUpperCase(), M, y); y += 1.5; rule() }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('CALL SHEET', M, y + 5)
  doc.setFontSize(10); doc.text(s.project, right, y + 2, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.text(s.schedule, right, y + 7, { align: 'right' })
  y += 12
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(`Shoot day ${s.day_no} of ${s.day_count}   ${star('date')}${formatDate(s.date, true)}`, M, y)
  y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const status = o.draft ? 'DRAFT, not published' : `Revision ${o.rev}${o.rev > 1 ? ', changed lines marked with *' : ''}${o.sentBy ? `, sent ${time(o.sentAt)} by ${o.sentBy}` : ''}`
  doc.text(status, M, y); y += 3; rule()

  const col = usable / 3
  const boxes: [string, string][] = [[`${star('general_call')}General call`, s.general_call || 'Not set'], [`${star('location')}Location`, s.location || 'Not set'], [`${star('hospital')}Nearest hospital`, s.hospital || 'Not set']]
  const top = y + 1
  let tall = 0
  boxes.forEach(([label, value], i) => {
    const x = M + i * col
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(label.toUpperCase(), x, top + 3)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(i === 0 ? 20 : 10)
    const lines = fit(value, col - 4); doc.text(lines, x, top + (i === 0 ? 11 : 8)); tall = Math.max(tall, (i === 0 ? 11 : 8) + (lines.length - 1) * 4.5)
  })
  y = top + tall + 4; rule()

  heading('Scenes')
  doc.setFontSize(8)
  const sx = [M, M + 14, M + 92, M + 112, M + 128]
  doc.setFont('helvetica', 'bold'); ['SC', 'HEADING', 'I/E D/N', 'PAGES', 'CAST'].forEach((t, i) => doc.text(t, sx[i], y + 3)); y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  if (!s.scenes.length) { doc.text('No scenes are on this shoot day.', M, y + 3); y += 6 }
  for (const sc of s.scenes) {
    const head = fit(sc.heading + (sc.partial ? ` (${sc.partial})` : ''), 76), cast = fit(sc.cast.join(', '), right - sx[4]); const h = Math.max(head.length, cast.length) * 4 + 2
    need(h); const m = star('scene:' + sc.id)
    doc.text(m + sc.number, sx[0], y + 3.5); doc.text(head, sx[1], y + 3.5); doc.text(`${sc.ie} ${sc.tod}`.trim(), sx[2], y + 3.5); doc.text(sc.pages, sx[3], y + 3.5); doc.text(cast, sx[4], y + 3.5)
    y += h
  }
  if (o.diff.removed.scenes.length) { doc.setFont('helvetica', 'italic'); doc.text(`Removed: ${o.diff.removed.scenes.join('; ')}`, M, y + 3.5); y += 5; doc.setFont('helvetica', 'normal') }

  heading('Cast')
  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  const cx = [M, M + 62, M + 128, M + 154]; ;['CHARACTER', 'ACTOR', 'MAKE-UP', 'CALL'].forEach((t, i) => doc.text(t, cx[i], y + 3)); y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  if (!s.cast.length) { doc.text('No cast is listed for these scenes in the breakdown.', M, y + 3); y += 6 }
  for (const c of s.cast) {
    need(6); doc.text(star('cast:' + c.id) + c.character, cx[0], y + 3.5); doc.text(c.actor || 'Not cast yet', cx[1], y + 3.5)
    doc.text(c.makeup || '-', cx[2], y + 3.5); doc.text(c.call || s.general_call || '-', cx[3], y + 3.5); y += 5.5
  }
  if (o.diff.removed.cast.length) { doc.setFont('helvetica', 'italic'); doc.text(`Removed: ${o.diff.removed.cast.join(', ')}`, M, y + 3.5); y += 5; doc.setFont('helvetica', 'normal') }

  heading('Crew')
  for (const d of s.crew) {
    need(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(d.department, M, y + 3.5); y += 5.5
    doc.setFont('helvetica', 'normal')
    for (const p of d.people) { need(5.5); doc.text(star('crew:' + p.id) + p.role, M + 4, y + 3.5); doc.text(p.name, M + 66, y + 3.5); doc.text(p.call || s.general_call || '-', M + 154, y + 3.5); y += 5 }
    y += 1.5
  }
  if (!s.crew.length) { doc.setFontSize(9); doc.text('No crew are listed yet.', M, y + 3.5); y += 6 }
  if (o.diff.removed.crew.length) { doc.setFont('helvetica', 'italic'); doc.text(`Removed: ${o.diff.removed.crew.join(', ')}`, M, y + 3.5); y += 5; doc.setFont('helvetica', 'normal') }

  if (s.notes.trim()) {
    heading(`${star('notes')}Notes`); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    for (const l of fit(s.notes, usable)) { need(5); doc.text(l, M, y + 3.5); y += 4.6 }
  }

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(`${s.project}, shoot day ${s.day_no}`, M, H - 8); doc.text(`Page ${p} of ${pages}`, right, H - 8, { align: 'right' })
  }
  return doc.output('blob')
}
