import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { SECTIONS } from './sections'
import type { SectionKey } from './types'

export interface AccessRequest { id: string; project_id: string; member_id: string; section: SectionKey; asked: 'view' | 'edit'; status: 'pending' | 'approved' | 'declined' | 'withdrawn'; created_at: string; decided_at: string | null }
export interface Grant { member_id: string; section: SectionKey; level: 'view' | 'edit'; project_id: string; created_at: string }
export const levelWords = (l: 'view' | 'edit') => (l === 'edit' ? 'read and write' : 'read only')
export interface DraftViewer { member_id: string; project_id: string }

/** The pages a person can ask for: every page that follows a permission setting. Shot list and Storyboard are one setting, so they are one line. */
export function requestablePages(): { key: SectionKey; label: string }[] {
  const seen = new Set<SectionKey>(); const out: { key: SectionKey; label: string }[] = []
  for (const s of SECTIONS) {
    if (!s.key || seen.has(s.key)) continue
    seen.add(s.key)
    out.push({ key: s.key, label: s.key === 'shots' ? 'Shot list and storyboard' : s.label })
  }
  return out
}
export const pageLabel = (key: SectionKey) => requestablePages().find((p) => p.key === key)?.label ?? key

/** Requests the person made, and (for owner, admins and heads of department) the requests they may decide. The database filters. */
export function useAccessRequests(pid: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['access-requests', pid],
    enabled: Boolean(pid) && enabled,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('access_requests').select('*').eq('project_id', pid!).order('created_at')
      if (error) return [] as AccessRequest[]   // the table does not exist yet
      return data as AccessRequest[]
    },
  })
}

export function useGrants(pid: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['grants', pid],
    enabled: Boolean(pid) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('member_section_grants').select('*').eq('project_id', pid!)
      if (error) return [] as Grant[]
      return data as Grant[]
    },
  })
}

export function useDraftViewers(pid: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['draft-viewers', pid],
    enabled: Boolean(pid) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_draft_viewers').select('member_id, project_id').eq('project_id', pid!)
      if (error) return [] as DraftViewer[]
      return data as DraftViewer[]
    },
  })
}
