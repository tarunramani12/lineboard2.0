import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { isOwnerOrAdmin, type Bundle, hasEditGrantFor } from './project'
import type { BItem } from './breakdown'
import type { SectionKey, Team } from './types'

export type ItemKind = 'prop' | 'equipment'
export type ItemStatus = 'needed' | 'confirmed' | 'ready' | 'returned'
export interface Item {
  id: string; project_id: string; schedule_id: string; kind: ItemKind; team_id: string; name: string; quantity: number
  category: string; status: ItemStatus; supplier: string; notes: string; created_at: string; updated_at: string
}
export interface ItemCost { item_id: string; project_id: string; amount: number; currency: string; note: string }

export const STATUSES: ItemStatus[] = ['needed', 'confirmed', 'ready', 'returned']
export const STATUS_LABEL: Record<ItemStatus, string> = { needed: 'Needed', confirmed: 'Confirmed', ready: 'Ready', returned: 'Returned' }

export const KINDS: Record<ItemKind, { section: SectionKey; path: string; title: string; one: string; plural: string; breakdown: 'props' | 'equipment'; categories: string[] }> = {
  prop: {
    section: 'props', path: 'props', title: 'Props', one: 'prop', plural: 'props', breakdown: 'props',
    categories: ['Hero prop', 'Hand prop', 'Set dressing', 'Food and drink', 'Weapon', 'Vehicle', 'Costume prop', 'Animal', 'Document', 'Other'],
  },
  equipment: {
    section: 'equipment', path: 'equipment', title: 'Equipment', one: 'item', plural: 'equipment items', breakdown: 'equipment',
    categories: ['Camera', 'Lenses', 'Support', 'Lighting', 'Grip', 'Power', 'Sound', 'Monitoring', 'Media and storage', 'Other'],
  },
}

export function useItems(pid: string | undefined, kind: ItemKind, withCosts: boolean) {
  return useQuery({
    queryKey: ['items', pid, kind, withCosts],
    enabled: Boolean(pid),
    refetchInterval: 20_000,
    queryFn: async () => {
      const [i, l] = await Promise.all([
        supabase.from('schedule_items').select('*').eq('project_id', pid!).eq('kind', kind),
        supabase.from('schedule_item_scenes').select('item_id, scene_id').eq('project_id', pid!),
      ])
      if (i.error) throw i.error
      if (l.error) throw l.error
      let costs = new Map<string, ItemCost>()
      if (withCosts) {
        const c = await supabase.from('schedule_item_costs').select('*').eq('project_id', pid!)
        if (c.error) throw c.error
        costs = new Map((c.data as ItemCost[]).map((x) => [x.item_id, { ...x, amount: Number(x.amount) }]))
      }
      const items = (i.data as Item[]).sort((a, b) => a.name.localeCompare(b.name))
      const ids = new Set(items.map((x) => x.id))
      const links = new Map<string, string[]>()
      for (const x of l.data as { item_id: string; scene_id: string }[]) if (ids.has(x.item_id)) links.set(x.item_id, [...(links.get(x.item_id) ?? []), x.scene_id])
      return { items, links, costs }
    },
  })
}

/** Edit access for this team in this list: the team's edit level plus HOD or an edit grant. Owner and admins always. */
export function canEditItemFor(b: Bundle, kind: ItemKind, teamId: string): boolean {
  if (isOwnerOrAdmin(b)) return true
  const sec = KINDS[kind].section
  return b.myLinks.some((l) => l.team_id === teamId && (l.is_hod || l.can_edit) && b.access.find((a) => a.team_id === teamId && a.section === sec)?.level === 'edit') || hasEditGrantFor(b, sec, teamId)
}
export const teamsIEditItems = (b: Bundle, kind: ItemKind): Team[] => b.teams.filter((t) => canEditItemFor(b, kind, t.id))
/** Cost is for the owner, admins and the Production team. */
export const canSeeCosts = (b: Bundle) => isOwnerOrAdmin(b) || b.myLinks.some((l) => b.teams.find((t) => t.id === l.team_id)?.role_tag === 'production')

export interface Suggestion { key: string; name: string; quantity: number; team_id: string; sceneIds: string[] }
/**
 * Names the breakdown lists for the scenes shot in a schedule that are not on the list yet.
 * One suggestion per name (ignoring case): the largest quantity asked for, every scene it appears in, the team that owns the first entry.
 */
export function suggestFromBreakdown(items: BItem[], category: 'props' | 'equipment', sceneIds: Set<string>, listed: string[]): Suggestion[] {
  const have = new Set(listed.map((n) => n.trim().toLowerCase()))
  const by = new Map<string, Suggestion>()
  for (const it of items) {
    if (it.category !== category || !sceneIds.has(it.scene_id) || it.quantity < 1) continue
    const key = it.name.trim().toLowerCase()
    if (!key || have.has(key)) continue
    const s = by.get(key)
    if (s) { s.quantity = Math.max(s.quantity, it.quantity); if (!s.sceneIds.includes(it.scene_id)) s.sceneIds.push(it.scene_id) }
    else by.set(key, { key, name: it.name.trim(), quantity: it.quantity, team_id: it.team_id, sceneIds: [it.scene_id] })
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const formatMoney = (amount: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR' }).format(amount)
