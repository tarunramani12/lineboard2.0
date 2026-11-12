import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { isOwnerOrAdmin, type Bundle } from './project'
import type { Team } from './types'

export type CrewKind = 'cast' | 'crew'
export interface CrewRow {
  id: string; project_id: string; team_id: string; kind: CrewKind; name: string; role: string; department: string
  call_time: string; makeup_time: string; notes: string; account_id: string | null; from_account: boolean; auto: boolean
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string
}
export interface CrewContact { row_id: string; project_id: string; phone: string; email: string }

export const CREW_ROLES = [
  'Director', 'First assistant director', 'Second assistant director', 'Producer', 'Production manager', 'Production coordinator',
  'Director of photography', 'Camera operator', 'First assistant camera', 'Gaffer', 'Key grip', 'Sound recordist', 'Boom operator',
  'Production designer', 'Art director', 'Props master', 'Costume designer', 'Make-up artist', 'Hair stylist', 'Script supervisor',
  'Location manager', 'VFX supervisor', 'Editor', 'Runner',
]

/** Ready-made departments. The team names are added when the list is built, and anyone who adds a person can add more. */
export const EXTRA_DEPARTMENTS = ['Locations', 'Stunts', 'Casting', 'Catering', 'Transport', 'Unit', 'Safety and medical', 'Accounts', 'Editorial', 'Music']
export function departmentOptions(teamNames: string[], rows: CrewRow[]): string[] {
  const base = [...teamNames, ...EXTRA_DEPARTMENTS]
  const used = [...new Set(rows.map((r) => r.department).filter((d) => d && !base.includes(d)))].sort((a, b) => a.localeCompare(b))
  return [...base, ...used]
}

export function useCastCrew(pid: string | undefined, withContacts: boolean) {
  return useQuery({
    queryKey: ['castcrew', pid, withContacts],
    enabled: Boolean(pid),
    refetchInterval: 30_000,
    queryFn: async () => {
      const r = await supabase.from('cast_crew_rows').select('*').eq('project_id', pid!)
      if (r.error) throw r.error
      let contacts = new Map<string, CrewContact>()
      if (withContacts) {
        const c = await supabase.from('cast_crew_contacts').select('*').eq('project_id', pid!)
        if (c.error) throw c.error
        contacts = new Map((c.data as CrewContact[]).map((x) => [x.row_id, x]))
      }
      const rows = (r.data as CrewRow[]).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'cast' ? -1 : 1) || (a.role || a.name).localeCompare(b.role || b.name))
      return { rows, contacts }
    },
  })
}

function accessLevel(b: Bundle, teamId: string) { return b.access.find((a) => a.team_id === teamId && a.section === 'cast_crew')?.level ?? 'none' }
export function canEditCrewFor(b: Bundle, teamId: string): boolean {
  if (isOwnerOrAdmin(b)) return true
  return b.myLinks.some((l) => l.team_id === teamId && (l.is_hod || l.can_edit) && accessLevel(b, teamId) === 'edit')
}
export const teamsICanEditCrew = (b: Bundle): Team[] => b.teams.filter((t) => canEditCrewFor(b, t.id))
/** Owner, admins, and AD-team members who can see Cast and crew. */
export function canSeeContacts(b: Bundle): boolean {
  if (isOwnerOrAdmin(b)) return true
  return b.myLinks.some((l) => b.teams.find((t) => t.id === l.team_id)?.is_ad_team && accessLevel(b, l.team_id) !== 'none')
}

export const isFormer = (r: CrewRow) => r.from_account && !r.account_id && !r.name
export const displayName = (r: CrewRow) => (isFormer(r) ? 'Former member' : r.name || '')
