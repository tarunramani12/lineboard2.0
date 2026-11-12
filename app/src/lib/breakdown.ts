import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { isOwnerOrAdmin, type Bundle } from './project'
import type { Element } from './fountain'
import type { Team } from './types'

export type Category = 'cast' | 'crew' | 'extras' | 'props' | 'equipment' | 'wardrobe' | 'hair_makeup' | 'sound' | 'special_effects'

export const CATEGORIES: { key: Category; label: string; one: string; defaults: string[] }[] = [
  { key: 'cast', label: 'Cast', one: 'cast member', defaults: [] },
  { key: 'crew', label: 'Crew', one: 'crew role', defaults: ['Stunt coordinator', 'Intimacy coordinator', 'Animal wrangler', 'Medic', 'Security'] },
  { key: 'extras', label: 'Extras', one: 'extras group', defaults: ['Background actors', 'Crowd', 'Pedestrians', 'Diners'] },
  { key: 'props', label: 'Props', one: 'prop', defaults: [] },
  { key: 'equipment', label: 'Equipment', one: 'equipment item', defaults: ['Dolly', 'Jib', 'Gimbal', 'Drone', 'Rain tower', 'Smoke machine', 'Generator'] },
  { key: 'wardrobe', label: 'Wardrobe', one: 'wardrobe item', defaults: [] },
  { key: 'hair_makeup', label: 'Hair and make-up', one: 'hair or make-up item', defaults: ['Blood', 'Bruising', 'Wet look', 'Wig', 'Prosthetics', 'Period hair'] },
  { key: 'sound', label: 'Sound', one: 'sound item', defaults: ['Wild track', 'Playback', 'Live music', 'Foley', 'Room tone'] },
  { key: 'special_effects', label: 'Special effects', one: 'effect', defaults: ['Rain', 'Smoke', 'Fire', 'Wind', 'Breakaway glass', 'Blood hit'] },
]
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<Category, string>

export interface BItem {
  id: string; project_id: string; scene_id: string; team_id: string; category: Category; name: string
  quantity: number; notes: string; ref_team_id: string | null
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string
}
export interface BScene {
  scene_id: string; project_id: string; location: string; story_date: string; synopsis: string; notes: string
  updated_by: string | null; updated_at: string
}
export const EMPTY_FORM = { location: '', story_date: '', synopsis: '', notes: '' }

export function useBreakdown(pid: string | undefined) {
  return useQuery({
    queryKey: ['breakdown', pid],
    enabled: Boolean(pid),
    refetchInterval: 20_000,
    queryFn: async () => {
      const [i, s] = await Promise.all([
        supabase.from('breakdown_items').select('*').eq('project_id', pid!),
        supabase.from('breakdown_scenes').select('*').eq('project_id', pid!),
      ])
      if (i.error) throw i.error
      if (s.error) throw s.error
      const items = (i.data as BItem[]).sort((a, b) => a.created_at.localeCompare(b.created_at))
      return { items, forms: new Map((s.data as BScene[]).map((f) => [f.scene_id, f])) }
    },
  })
}

// ---- Who may do what. The database enforces all of this; these only decide what the screen offers.

/** Edit access on Breakdown for this team: the team's edit level plus HOD or an edit grant. Owner and admins always. */
export function canEditBreakdownFor(b: Bundle, teamId: string): boolean {
  if (isOwnerOrAdmin(b)) return true
  return b.myLinks.some((l) => l.team_id === teamId && (l.is_hod || l.can_edit)
    && b.access.find((a) => a.team_id === teamId && a.section === 'breakdown')?.level === 'edit')
}
export const teamsIEditBreakdown = (b: Bundle): Team[] => b.teams.filter((t) => canEditBreakdownFor(b, t.id))

// ---- Reading the script for cast

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase())

/** The speaking characters in a scene's elements, in order of first appearance: "ANNA (V.O.)" and "ANNA" are one person. */
export function detectCast(elements: Element[]): string[] {
  const seen = new Map<string, string>()
  for (const e of elements) {
    if (e.kind !== 'character') continue
    const name = e.text.replace(/\(.*?\)/g, '').replace(/\^$/, '').replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toUpperCase()
    if (!seen.has(key)) seen.set(key, titleCase(name))
  }
  return [...seen.values()]
}

/** Counts per category for the list. Equipment with quantity 0 is listed but not counted. */
export function countByCategory(items: BItem[]): Map<Category, number> {
  const m = new Map<Category, number>()
  for (const i of items) {
    if (i.category === 'equipment' && i.quantity === 0) continue
    m.set(i.category, (m.get(i.category) ?? 0) + 1)
  }
  return m
}

/** Names already used in a category across the project, for the dropdown, without the ones in the defaults. */
export function usedNames(items: BItem[], category: Category, defaults: string[]): string[] {
  const set = new Set(items.filter((i) => i.category === category && !i.ref_team_id).map((i) => i.name))
  return [...defaults, ...[...set].filter((n) => !defaults.includes(n)).sort((a, b) => a.localeCompare(b))]
}
