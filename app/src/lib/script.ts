import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Element } from './fountain'
import type { Scene } from './types'

export interface SceneText { scene_id: string; elements: Element[]; rev: number; updated_at: string }
export interface SceneLock { scene_id: string; holder: string; expires_at: string }
export interface MyScriptAccess { mode: 'none' | 'selected' | 'all'; sceneIds: Set<string> }

/** Text of every scene the database lets this person read. Other scenes simply do not come back. */
export function useSceneTexts(pid: string | undefined, sceneIds: string[]) {
  return useQuery({
    queryKey: ['scene_text', pid, sceneIds.length],
    enabled: Boolean(pid) && sceneIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('scene_text').select('scene_id, elements, rev, updated_at').in('scene_id', sceneIds)
      if (error) throw error
      return new Map((data as SceneText[]).map((r) => [r.scene_id, r]))
    },
  })
}

/** Who is editing which scene. Refreshed often so "being edited by" stays honest. */
export function useSceneLocks(pid: string | undefined, sceneIds: string[]) {
  return useQuery({
    queryKey: ['scene_locks', pid, sceneIds.length],
    enabled: Boolean(pid) && sceneIds.length > 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('scene_locks').select('scene_id, holder, expires_at').in('scene_id', sceneIds)
      if (error) throw error
      const now = Date.now()
      return new Map((data as SceneLock[]).filter((l) => new Date(l.expires_at).getTime() > now).map((l) => [l.scene_id, l]))
    },
  })
}

/** Which scenes the owner shared with me. Owners and admins read everything. */
export function useMyScriptAccess(memberId: string, everything: boolean) {
  return useQuery({
    queryKey: ['my_script_access', memberId],
    enabled: !everything,
    queryFn: async (): Promise<MyScriptAccess> => {
      const [a, s] = await Promise.all([
        supabase.from('scene_access').select('mode').eq('member_id', memberId).maybeSingle(),
        supabase.from('scene_access_scenes').select('scene_id').eq('member_id', memberId),
      ])
      if (a.error) throw a.error
      if (s.error) throw s.error
      return { mode: (a.data?.mode ?? 'none') as MyScriptAccess['mode'], sceneIds: new Set((s.data ?? []).map((r) => r.scene_id as string)) }
    },
  })
}

export function canReadScene(everything: boolean, acc: MyScriptAccess | undefined, sceneId: string): boolean {
  if (everything) return true
  if (!acc) return false
  return acc.mode === 'all' || (acc.mode === 'selected' && acc.sceneIds.has(sceneId))
}

export interface LockResult { mine: boolean; holder: string; name: string | null; expires_at: string }
export async function acquireLock(sceneId: string): Promise<LockResult> {
  const { data, error } = await supabase.rpc('acquire_scene_lock', { sid: sceneId })
  if (error) throw error
  return data as LockResult
}
export async function releaseLock(sceneId: string) {
  await supabase.rpc('release_scene_lock', { sid: sceneId })
}
export async function saveSceneText(sceneId: string, heading: string, elements: Element[], expectedRev: number): Promise<number> {
  const { data, error } = await supabase.rpc('save_scene_text', { sid: sceneId, new_heading: heading, new_elements: elements.map((e) => ({ kind: e.kind, text: e.text })), expected_rev: expectedRev })
  if (error) throw error
  return data as number
}

/** Where a new scene goes in the order, and what number to suggest for it. */
export function placeAfter(scenes: Scene[], afterId: string | null): { sort_order: number; renumber: boolean } {
  if (!scenes.length) return { sort_order: 10, renumber: false }
  if (!afterId) return { sort_order: scenes[scenes.length - 1].sort_order + 10, renumber: false }
  const i = scenes.findIndex((s) => s.id === afterId)
  const prev = scenes[i].sort_order
  const next = scenes[i + 1]?.sort_order ?? prev + 10
  const mid = Math.floor((prev + next) / 2)
  return mid > prev && mid < next ? { sort_order: mid, renumber: false } : { sort_order: prev + 1, renumber: true }
}

/** Final Draft's revision colours, in order. Revision 0 is the white, locked original. */
export const REVISION_NAMES = ['Blue', 'Pink', 'Yellow', 'Green', 'Goldenrod', 'Buff', 'Salmon', 'Cherry']
const REVISION_SWATCH = ['#2563eb', '#db2777', '#ca8a04', '#16a34a', '#b45309', '#a16207', '#e0675a', '#be123c']
export function revisionName(n: number): string {
  return n <= 0 ? 'White' : REVISION_NAMES[(n - 1) % REVISION_NAMES.length]
}
export function revisionColour(n: number): string {
  return n <= 0 ? '#8a8a8a' : REVISION_SWATCH[(n - 1) % REVISION_SWATCH.length]
}
/** "Blue", or "Blue (9)" once the colours have gone round. */
export function revisionLabel(n: number): string {
  return n > REVISION_NAMES.length ? `${revisionName(n)} (${n})` : revisionName(n)
}
