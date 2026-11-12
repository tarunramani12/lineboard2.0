export type ProjectRole = 'owner' | 'admin' | 'member'
export type SectionKey =
  | 'script' | 'shots' | 'cast_crew' | 'props' | 'equipment' | 'breakdown' | 'schedule' | 'call_sheets'
export type AccessLevel = 'none' | 'view' | 'edit'
export type SceneStatus = 'active' | 'omitted'
export type SceneAccessMode = 'none' | 'selected' | 'all'

export interface Project {
  id: string; name: string; owner_id: string; status: string
  script_locked: boolean; draft_no: number; revision_no: number; image_cap_mb: number; mail_id: string | null; mail_name: string; reply_to: string; mail_id_changed_at: string | null; email_paused: boolean; created_at: string; last_active_at: string
}
export interface Team { id: string; project_id: string; name: string; is_ad_team: boolean }
export interface TeamAccess { team_id: string; section: SectionKey; level: AccessLevel }
export interface Member {
  id: string; project_id: string; account_id: string | null; role: ProjectRole
  invited_by: string | null; joined_at: string
}
export interface MemberTeam { member_id: string; team_id: string; is_hod: boolean; can_edit: boolean }
export interface Invite {
  id: string; project_id: string; team_id: string; email: string
  expires_at: string; accepted_at: string | null; created_at: string
}
export interface JoinCode {
  id: string; team_id: string; code: string; expires_at: string; revoked_at: string | null; created_at: string
}
export interface Scene {
  id: string; project_id: string; display_number: string | null; heading: string
  status: SceneStatus; sort_order: number; revised_in: number | null
}
