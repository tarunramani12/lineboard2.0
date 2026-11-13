import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { isOwnerOrAdmin, type Bundle, hasEditGrantFor } from './project'
import type { Scene, Team } from './types'

export type ShotStatus = 'planned' | 'done' | 'dropped'
export interface Shot {
  id: string; project_id: string; scene_id: string; team_id: string; position: number; status: ShotStatus
  description: string; size: string; shot_type: string; lens: string; movement: string; action: string
  cast_needed: string; crew_needed: string; vfx_required: string; sound_required: string; special_effects: string
  silent: boolean; notes: string
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string
}
/** The columns a person edits. Status, ids and the audit columns are not part of the form. */
export const SHOT_FIELDS = [
  'description', 'size', 'shot_type', 'lens', 'movement', 'action', 'cast_needed', 'crew_needed',
  'vfx_required', 'sound_required', 'special_effects', 'silent', 'notes',
] as const
export type ShotField = (typeof SHOT_FIELDS)[number]
export type ShotDraft = Pick<Shot, ShotField>
export const emptyShot = (): ShotDraft => ({
  description: '', size: '', shot_type: '', lens: '', movement: '', action: '', cast_needed: '', crew_needed: '',
  vfx_required: '', sound_required: '', special_effects: '', silent: false, notes: '',
})

export const SIZES = ['Extreme close-up', 'Close-up', 'Medium close-up', 'Medium shot', 'Medium wide shot', 'Full shot', 'Wide shot', 'Extreme wide shot']
const SIZE_SHORT: Record<string, string> = { ecu: 'Extreme close-up', cu: 'Close-up', mcu: 'Medium close-up', ms: 'Medium shot', mws: 'Medium wide shot', fs: 'Full shot', ws: 'Wide shot', ews: 'Extreme wide shot' }
/** The full name of a shot size. Shots saved with the short form (CU, MS) read as the full name. */
export const sizeName = (v: string): string => SIZE_SHORT[v.trim().toLowerCase()] ?? v
export const SHOT_TYPES = ['Master', 'Single', 'Two-shot', 'Over the shoulder', 'POV', 'Insert', 'Cutaway', 'Establishing']
export const FIELD_LABEL: Record<ShotField, string> = {
  description: 'Description', size: 'Shot size', shot_type: 'Shot type', lens: 'Lens', movement: 'Movement', action: 'Action',
  cast_needed: 'Cast needed', crew_needed: 'Crew needed', vfx_required: 'VFX required', sound_required: 'Sound effects required',
  special_effects: 'Special effects', silent: 'Silent shot', notes: 'Notes',
}
export const LENSES = ['14mm', '18mm', '24mm', '28mm', '35mm', '50mm', '85mm', '100mm', '135mm', '200mm']
export const MOVEMENTS = ['Static', 'Pan', 'Tilt', 'Dolly', 'Track', 'Handheld', 'Crane', 'Steadicam', 'Zoom']
export const STATUS_TEXT: Record<ShotStatus, string> = { planned: 'Planned', done: 'Done', dropped: 'Dropped' }

/** `fast` is for screens where the day's status changes are watched, such as the call sheet: refresh every few seconds. */
export function useShots(pid: string | undefined, fast = false) {
  return useQuery({
    queryKey: ['shots', pid],
    enabled: Boolean(pid),
    refetchInterval: fast ? 5_000 : 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('shots').select('*').eq('project_id', pid!)
      if (error) throw error
      return (data as Shot[]).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
    },
  })
}

// ---- Who may do what. The database enforces all of this; these helpers only decide what the screen offers.

function accessLevel(b: Bundle, teamId: string): 'none' | 'view' | 'edit' {
  return b.access.find((a) => a.team_id === teamId && a.section === 'shots')?.level ?? 'none'
}
/** Edit access on Shots for this team: the team's edit level, plus HOD or an edit grant. Owner and admins always. */
export function canEditShotsFor(b: Bundle, teamId: string): boolean {
  if (isOwnerOrAdmin(b)) return true
  return b.myLinks.some((l) => l.team_id === teamId && (l.is_hod || l.can_edit) && accessLevel(b, teamId) === 'edit') || hasEditGrantFor(b, 'shots', teamId)
}
/** Teams a new shot can belong to: the ones this person edits for. */
export function teamsIEdit(b: Bundle): Team[] {
  return b.teams.filter((t) => canEditShotsFor(b, t.id))
}
export function canChangeStatus(b: Bundle): boolean {
  if (isOwnerOrAdmin(b)) return true
  return b.myLinks.some((l) => {
    const t = b.teams.find((x) => x.id === l.team_id)
    return t?.is_ad_team && (l.is_hod || l.can_edit) && accessLevel(b, t.id) !== 'none'
  })
}
/** Can this person edit shots as the team with this name (VFX, Sound)? */
export function canEditShotsAs(b: Bundle, teamName: string): boolean {
  const t = b.teams.find((x) => x.role_tag === teamName.toLowerCase())
  return Boolean(t) && canEditShotsFor(b, t!.id)
}

// ---- Order and numbers

export function shotLabel(scene: Scene, sceneIndex: number, n: number): string {
  return `${scene.display_number ?? sceneIndex + 1}-${n}`
}

/** A position for a shot placed after another (or at the end). renumber = the gaps ran out: space the scene out first. */
export function slotAfter(inScene: Shot[], afterId: string | null): { position: number; renumber: boolean } {
  if (!inScene.length) return { position: 10, renumber: false }
  if (!afterId) return { position: inScene[inScene.length - 1].position + 10, renumber: false }
  const i = inScene.findIndex((s) => s.id === afterId)
  const prev = inScene[i].position
  const next = inScene[i + 1]?.position ?? prev + 10
  const mid = Math.floor((prev + next) / 2)
  return mid > prev && mid < next ? { position: mid, renumber: false } : { position: prev + 1, renumber: true }
}

/**
 * Drag a shot to a new place in its scene. Returns the position changes to save: just the moved shot when
 * there is a gap to drop it into, otherwise the whole scene spaced out again. toIndex counts in the list without the moved shot.
 */
export function reorderChanges(inScene: Shot[], id: string, toIndex: number): { id: string; position: number }[] {
  const moved = inScene.find((s) => s.id === id)
  if (!moved) return []
  const rest = inScene.filter((s) => s.id !== id)
  const at = Math.max(0, Math.min(toIndex, rest.length))
  if (inScene.findIndex((s) => s.id === id) === at) return []
  const prev = at > 0 ? rest[at - 1].position : 0
  const next = at < rest.length ? rest[at].position : prev + 20
  const mid = Math.floor((prev + next) / 2)
  if (mid > prev && mid < next) return [{ id, position: mid }]
  const order = [...rest.slice(0, at), moved, ...rest.slice(at)]
  return order.map((s, i) => ({ id: s.id, position: (i + 1) * 10 })).filter((c) => inScene.find((s) => s.id === c.id)!.position !== c.position)
}
