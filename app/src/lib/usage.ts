import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Totals for the owner's usage dashboard (database function app_overview; refuses anyone who is not an app admin). */
export interface Overview {
  generated_at: string
  accounts: number; accounts_new_7d: number; accounts_new_30d: number; accounts_active_7d: number; accounts_active_30d: number
  projects: number; projects_active_30d: number; projects_read_only: number; projects_script_locked: number
  owners: number; admins: number; memberships: number; people_in_projects: number
  avg_people_per_project: number; max_people_in_a_project: number; avg_projects_per_owner: number
  scenes: number; shots: number; storyboard_frames: number; cast_crew_rows: number; call_sheets: number; locations: number; schedules: number
  storage_bytes: number; storage_files: number; storage_by_bucket: Record<string, number>
  emails_sent_30d: number; emails_failed: number; emails_waiting: number; join_requests_waiting: number
}
export interface ProjectRow {
  project_id: string; name: string; owner_name: string; owner_email: string; created_at: string; last_active_at: string
  status: string; script_locked: boolean; people: number; admins: number; scenes: number; shots: number; frames: number
  storage_bytes: number; image_cap_mb: number
}
export interface PersonRow {
  account_id: string; display_name: string; email: string; created_at: string; last_sign_in_at: string | null
  projects_owned: number; projects_admin: number; projects_member: number; storage_bytes: number
}

/** True when the signed-in person is on the app admin list. An older database without the function answers false. */
export function useIsAppAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: ['is-app-admin', userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_app_admin')
      return !error && data === true
    },
  })
}

export function useOverview(enabled: boolean) {
  return useQuery({
    queryKey: ['usage-overview'], enabled, refetchInterval: 60_000,
    queryFn: async () => { const { data, error } = await supabase.rpc('app_overview'); if (error) throw error; return data as Overview },
  })
}
export function useUsageProjects(enabled: boolean) {
  return useQuery({
    queryKey: ['usage-projects'], enabled,
    queryFn: async () => { const { data, error } = await supabase.rpc('app_projects'); if (error) throw error; return (data ?? []) as ProjectRow[] },
  })
}
export function useUsagePeople(enabled: boolean) {
  return useQuery({
    queryKey: ['usage-people'], enabled,
    queryFn: async () => { const { data, error } = await supabase.rpc('app_people'); if (error) throw error; return (data ?? []) as PersonRow[] },
  })
}

export function bytesText(n: number): string {
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB'
  if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

/** "today", "3 days ago", "2 months ago", or "never" for a missing date. */
export function agoText(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 60) return days + ' days ago'
  return Math.floor(days / 30) + ' months ago'
}

/** The Supabase project reference is the first part of the project address (https://REF.supabase.co). */
export function supabaseRef(url: string | undefined): string | null {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url ?? '')
  return m ? m[1] : null
}
