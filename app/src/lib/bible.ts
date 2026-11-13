import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { hasEditGrantFor, isOwnerOrAdmin, type Bundle } from './project'

export const MOOD_BUCKET = 'moodboard'

export interface BibleFormat {
  project_id: string; frame_rate: string; resolution: string; camera_format: string; delivery: string
  runtime_target: string; look_notes: string; notes: string; updated_by: string | null; updated_at: string
}
export interface MoodItem {
  id: string; project_id: string; kind: 'image' | 'text'; image_path: string | null; caption: string; description: string
  position: number; bytes: number; created_by: string | null; updated_at: string
}

export const EMPTY_FORMAT = { frame_rate: '24', resolution: '', camera_format: '', delivery: '', look_notes: '', notes: '' }
export type FormatDraft = typeof EMPTY_FORMAT

// Ready-made lists for the Choice dropdowns (values already used in the project are added by the dropdown).
export const FRAME_RATES = ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '120']
export const RESOLUTIONS = ['HD 1920x1080', '2K 2048x1080', 'UHD 3840x2160', '4K DCI 4096x2160', '4.5K', '6K', '8K']
export const CAMERA_FORMATS = ['Digital cinema camera', 'Mirrorless camera', 'DSLR', 'Super 35', 'Full frame', 'Large format', 'Anamorphic', '16 mm film', '35 mm film', 'Phone']
export const DELIVERY_FORMATS = ['Cinema (DCP)', 'Broadcast', 'Streaming', 'Festival screener', 'Web and social', 'Vertical video']

export function useBibleFormat(pid: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['bible', pid],
    enabled: Boolean(pid) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('project_bible').select('*').eq('project_id', pid!).maybeSingle()
      if (error) throw error
      return (data as BibleFormat | null) ?? null
    },
  })
}

export function useMoodboard(pid: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['moodboard', pid],
    enabled: Boolean(pid) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('moodboard_items').select('*').eq('project_id', pid!).order('position').order('created_at')
      if (error) throw error
      return data as MoodItem[]
    },
  })
}

/** Signed links for moodboard pictures, valid for an hour. */
export function useMoodUrls(paths: string[]) {
  const key = [...paths].sort().join('|')
  return useQuery({
    queryKey: ['mood-signed', key],
    enabled: paths.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(MOOD_BUCKET).createSignedUrls(paths, 3600)
      if (error) throw error
      return new Map(data.map((d) => [d.path ?? '', d.signedUrl ?? '']))
    },
  })
}

export async function uploadMoodImage(pid: string, blob: Blob): Promise<string> {
  const path = `${pid}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(MOOD_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}
export async function removeMoodFiles(paths: string[]) {
  if (paths.length) await supabase.storage.from(MOOD_BUCKET).remove(paths)
}
/** Delete every moodboard file of a project (used when the project is deleted). */
export async function removeMoodFolder(pid: string): Promise<void> {
  const { data } = await supabase.storage.from(MOOD_BUCKET).list(pid, { limit: 1000 })
  const files = (data ?? []).filter((x) => x.id).map((x) => `${pid}/${x.name}`)
  if (files.length) await supabase.storage.from(MOOD_BUCKET).remove(files)
}

export const draftFrom = (f: BibleFormat | null | undefined): FormatDraft => f
  ? { frame_rate: f.frame_rate, resolution: f.resolution, camera_format: f.camera_format, delivery: f.delivery, look_notes: f.look_notes, notes: f.notes }
  : { ...EMPTY_FORMAT }
export const sameDraft = (a: FormatDraft, b: FormatDraft) => (Object.keys(a) as (keyof FormatDraft)[]).every((k) => a[k] === b[k])

/** Move one card earlier (-1) or later (1) and return the new order as ids. */
export function reorderIds(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id), j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const next = [...ids]; [next[i], next[j]] = [next[j], next[i]]
  return next
}

export type BibleArea = 'format' | 'mood'

/** The team that owns a part of the Project bible (Camera owns the format, Direction the moodboard, unless the owner changed it). */
export const bibleOwnerTeam = (b: Bundle, area: BibleArea): string | null =>
  (area === 'format' ? b.project.bible_format_team : b.project.bible_mood_team) ?? null

/** May this person change that part? The owner team's edit level for the Project bible plus head of department or an edit grant. Owner and admins always. */
export function canEditBibleArea(b: Bundle, area: BibleArea): boolean {
  if (isOwnerOrAdmin(b)) return true
  const team = bibleOwnerTeam(b, area)
  if (!team) return false
  const level = b.access.find((a) => a.team_id === team && a.section === 'bible')?.level
  return (level === 'edit' && b.myLinks.some((l) => l.team_id === team && (l.is_hod || l.can_edit))) || hasEditGrantFor(b, 'bible', team)
}
