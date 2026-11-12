import { CATEGORIES, type BItem, type BScene } from './breakdown'
import type { CrewContact, CrewRow } from './castcrew'
import { STATUS_LABEL, formatMoney, type Item, type ItemCost, type ItemKind } from './items'
import { dayEntries, formatDate, formatRange, headingParts, scenesOnAnyDay, type Placement, type Schedule, type ShootDay, type ShotPlacement } from './schedule'
import { STATUS_TEXT, shotLabel, sizeName, type Shot } from './shots'
import { stamp, type Block, type Report, type Paper } from './reportPdf'
import type { Scene, Team } from './types'

const num = (s: Scene, all: Scene[]) => s.display_number ?? String(all.indexOf(s) + 1)
const meta = (project: string) => `${project}  ·  ${stamp()}`

export function breakdownReport(a: { project: string; size: Paper; scenes: Scene[]; items: BItem[]; forms: Map<string, BScene>; teams: Team[] }): Report {
  const team = (id: string) => a.teams.find((t) => t.id === id)?.name ?? ''
  const blocks: Block[] = a.scenes.filter((s) => s.status === 'active').map((s) => {
    const f = a.forms.get(s.id)
    const sub = [f?.location && `Location: ${f.location}`, f?.story_date && `Story date: ${f.story_date}`, f?.synopsis && `Synopsis: ${f.synopsis}`, f?.notes && `Notes: ${f.notes}`].filter(Boolean).join('   ')
    const rows = CATEGORIES.flatMap((c) => a.items.filter((i) => i.scene_id === s.id && i.category === c.key)
      .map((i) => [c.label, i.name, i.category === 'equipment' && i.quantity === 0 ? 'Listed' : String(i.quantity), team(i.team_id), i.notes]))
    return { heading: `${num(s, a.scenes)}  ${s.heading || 'No heading'}`, sub, cols: [{ label: 'Category', w: 18 }, { label: 'Item', w: 30 }, { label: 'Qty', w: 8, align: 'right' as const }, { label: 'Team', w: 17 }, { label: 'Notes', w: 27 }], rows, empty: 'No elements listed for this scene.' }
  })
  return { title: 'Breakdown', subtitle: 'One section per scene: the form details and every element with its owning team.', meta: meta(a.project), size: a.size, blocks, footer: `${a.project}, breakdown` }
}

export function castCrewReport(a: { project: string; size: Paper; rows: CrewRow[]; contacts: Map<string, CrewContact>; withContacts: boolean; teams: Team[] }): Report {
  const team = (id: string) => a.teams.find((t) => t.id === id)?.name ?? ''
  const name = (r: CrewRow) => (r.from_account && !r.account_id && !r.name ? 'Former member' : r.name || (r.kind === 'cast' ? 'Not cast yet' : 'No name'))
  const contact = (r: CrewRow) => { const c = a.contacts.get(r.id); return c ? [c.phone, c.email].filter(Boolean).join('  ') : '' }
  const cols = (first: string) => [{ label: first, w: 22 }, { label: 'Role', w: 22 }, { label: 'Call', w: 8 }, { label: 'Make-up', w: 9 }, ...(a.withContacts ? [{ label: 'Contact', w: 26 }] : [{ label: 'Managed by', w: 14 }])]
  const line = (r: CrewRow) => [name(r), r.kind === 'cast' ? `as ${r.role}` : r.role, r.call_time, r.makeup_time, a.withContacts ? contact(r) : team(r.team_id)]
  const cast = a.rows.filter((r) => r.kind === 'cast'), crew = a.rows.filter((r) => r.kind === 'crew')
  const depts = [...new Set(crew.map((r) => r.department || 'Crew'))].sort((x, y) => x.localeCompare(y))
  const blocks: Block[] = [{ heading: 'Cast', cols: cols('Actor'), rows: cast.map(line), empty: 'No cast yet.' },
    ...depts.map((d) => ({ heading: d, cols: cols('Name'), rows: crew.filter((r) => (r.department || 'Crew') === d).map(line) }))]
  return { title: 'Cast and crew', subtitle: a.withContacts ? undefined : 'Phone and email are not included.', meta: meta(a.project), size: a.size, blocks, footer: `${a.project}, cast and crew` }
}

export function itemsReport(a: { project: string; size: Paper; kind: ItemKind; schedule: Schedule; items: Item[]; costs: Map<string, ItemCost> | null; teams: Team[]; links: Map<string, string[]>; scenes: Scene[] }): Report {
  const team = (id: string) => a.teams.find((t) => t.id === id)?.name ?? ''
  const title = a.kind === 'prop' ? 'Props' : 'Equipment'
  const showCost = a.costs !== null
  const sceneNums = (id: string) => (a.links.get(id) ?? []).map((sid) => { const s = a.scenes.find((x) => x.id === sid); return s ? num(s, a.scenes) : '' }).filter(Boolean).join(', ')
  const cols = [{ label: 'Item', w: 22 }, { label: 'Qty', w: 6, align: 'right' as const }, { label: 'Category', w: 14 }, { label: 'Status', w: 11 }, { label: 'Supplier', w: 14 }, { label: 'Scenes', w: 10 }, ...(showCost ? [{ label: 'Cost', w: 11, align: 'right' as const }] : [])]
  const depts = [...new Set(a.items.map((i) => team(i.team_id)))].sort()
  const blocks: Block[] = depts.map((d) => ({
    heading: d, cols,
    rows: a.items.filter((i) => team(i.team_id) === d).sort((x, y) => x.name.localeCompare(y.name)).map((i) => [i.name, String(i.quantity), i.category, STATUS_LABEL[i.status], i.supplier, sceneNums(i.id), ...(showCost ? [a.costs!.get(i.id) ? formatMoney(a.costs!.get(i.id)!.amount, a.costs!.get(i.id)!.currency) : ''] : [])]),
  }))
  if (!blocks.length) blocks.push({ cols, rows: [], empty: `No ${title.toLowerCase()} on this list yet.` })
  return { title: `${title}, ${a.schedule.name}`, subtitle: `${formatRange(a.schedule.start_date, a.schedule.end_date)}. ${a.items.length} ${a.items.length === 1 ? 'line' : 'lines'}, ${a.items.reduce((n, i) => n + i.quantity, 0)} in all.${showCost ? '' : ' Cost is not included.'}`, meta: meta(a.project), size: a.size, blocks, footer: `${a.project}, ${title.toLowerCase()}, ${a.schedule.name}` }
}

export function scheduleReport(a: { project: string; size: Paper; schedule: Schedule; days: ShootDay[]; placements: Placement[]; shotPlacements: ShotPlacement[]; shots: Shot[]; scenes: Scene[]; castOf: (s: Scene) => string[]; pagesOf: (s: Scene) => string }): Report {
  const blocks: Block[] = a.days.map((d, i) => {
    const entries = dayEntries(d.id, a.placements, a.shotPlacements, a.shots)
    const rows = entries.map((e) => ({ e, s: a.scenes.find((x) => x.id === e.scene_id) })).filter((x): x is { e: typeof entries[number]; s: Scene } => Boolean(x.s)).map(({ e, s }) => {
      const hp = headingParts(s.heading); const total = a.shots.filter((x) => x.scene_id === s.id).length
      const part = total > 0 && e.shot_ids.length < total ? ` (${e.shot_ids.length} of ${total} shots)` : ''
      return [num(s, a.scenes), s.heading + part, `${hp.ie} ${hp.tod}`.trim(), a.pagesOf(s), a.castOf(s).join(', ')]
    })
    return { heading: `Day ${i + 1}  ${formatDate(d.day_date, true)}`, sub: [d.location && `Location: ${d.location}`, d.notes && `Notes: ${d.notes}`].filter(Boolean).join('   '), cols: [{ label: 'Sc', w: 6 }, { label: 'Heading', w: 34 }, { label: 'I/E D/N', w: 12 }, { label: 'Pages', w: 8 }, { label: 'Cast', w: 26 }], rows, empty: 'No scenes on this day.' }
  })
  const placed = scenesOnAnyDay(a.placements, a.shotPlacements, a.shots)
  const left = a.scenes.filter((s) => s.status === 'active' && !placed.has(s.id))
  if (left.length) blocks.push({ heading: 'Not scheduled', cols: [{ label: 'Sc', w: 6 }, { label: 'Heading', w: 60 }], rows: left.map((s) => [num(s, a.scenes), s.heading]) })
  return { title: `Schedule, ${a.schedule.name}`, subtitle: formatRange(a.schedule.start_date, a.schedule.end_date), meta: meta(a.project), size: a.size, blocks, footer: `${a.project}, schedule` }
}

export function shotsReport(a: { project: string; size: Paper; scenes: Scene[]; shots: Shot[]; teams: Team[] }): Report {
  const blocks: Block[] = a.scenes.filter((s) => s.status === 'active').map((s) => {
    const list = a.shots.filter((x) => x.scene_id === s.id)
    return {
      heading: `${num(s, a.scenes)}  ${s.heading || 'No heading'}`,
      cols: [{ label: 'Shot', w: 7 }, { label: 'Size', w: 12 }, { label: 'Description', w: 27 }, { label: 'Lens / move', w: 14 }, { label: 'Flags', w: 9 }, { label: 'Status', w: 9 }],
      rows: list.map((x, n) => [shotLabel(s, a.scenes.indexOf(s), n + 1), sizeName(x.size), x.description || x.action, [x.lens, x.movement].filter(Boolean).join(', '), [x.vfx_required && 'VFX', x.special_effects && 'SFX', x.silent && 'SILENT'].filter(Boolean).join(' '), STATUS_TEXT[x.status]]),
      empty: 'No shots yet.',
    }
  })
  return { title: 'Shot list', subtitle: `${a.shots.length} shots. Storyboard pictures are in the storyboard PDF.`, meta: meta(a.project), size: a.size, blocks, footer: `${a.project}, shot list` }
}
