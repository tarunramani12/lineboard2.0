import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { DEPARTMENT_ORDER } from './sections'
import type {
  AccessLevel, Invite, JoinCode, Member, MemberTeam, Project, Scene, SectionKey, Team, TeamAccess,
} from './types'

export interface PersonRow extends Member { name: string; former: boolean }

export interface Bundle {
  project: Project
  teams: Team[]
  access: TeamAccess[]
  people: PersonRow[]
  memberTeams: MemberTeam[]
  me: Member
  myLinks: MemberTeam[]
}

export async function fetchBundle(pid: string, uid: string): Promise<Bundle> {
  const [p, t, m] = await Promise.all([
    supabase.from('projects').select('*').eq('id', pid).single(),
    supabase.from('teams').select('*').eq('project_id', pid),
    supabase.from('members').select('*').eq('project_id', pid),
  ])
  if (p.error) throw p.error
  if (t.error) throw t.error
  if (m.error) throw m.error
  const teams = (t.data as Team[]).sort((a, b) => {
    const ia = DEPARTMENT_ORDER.indexOf(a.name), ib = DEPARTMENT_ORDER.indexOf(b.name)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name)
  })
  const members = m.data as Member[]
  const teamIds = teams.map((x) => x.id)
  const accountIds = members.map((x) => x.account_id).filter((x): x is string => Boolean(x))
  const [a, mt, pr] = await Promise.all([
    supabase.from('team_section_access').select('*').in('team_id', teamIds),
    supabase.from('member_teams').select('*').in('team_id', teamIds),
    supabase.from('profiles').select('id, display_name').in('id', accountIds),
  ])
  if (a.error) throw a.error
  if (mt.error) throw mt.error
  const names = new Map((pr.data ?? []).map((x) => [x.id as string, x.display_name as string]))
  const people: PersonRow[] = members
    .map((x) => ({
      ...x,
      former: !x.account_id,
      name: x.account_id ? names.get(x.account_id) || 'Unnamed' : 'Former member',
    }))
    .sort((x, y) => (x.role === 'owner' ? -1 : y.role === 'owner' ? 1 : x.name.localeCompare(y.name)))
  const me = members.find((x) => x.account_id === uid)
  if (!me) throw new Error('You are not on this project.')
  const memberTeams = mt.data as MemberTeam[]
  return {
    project: p.data as Project, teams, access: a.data as TeamAccess[], people, memberTeams, me,
    myLinks: memberTeams.filter((x) => x.member_id === me.id),
  }
}

export function useBundle(pid: string | undefined, uid: string | undefined) {
  return useQuery({
    queryKey: ['project', pid],
    queryFn: () => fetchBundle(pid!, uid!),
    enabled: Boolean(pid && uid),
  })
}

export function useScenes(pid: string | undefined) {
  return useQuery({
    queryKey: ['scenes', pid],
    enabled: Boolean(pid),
    queryFn: async () => {
      const { data, error } = await supabase.from('scenes').select('*').eq('project_id', pid!)
      if (error) throw error
      return (data as Scene[]).sort(
        (a, b) => a.sort_order - b.sort_order || (a.display_number ?? '').localeCompare(b.display_number ?? '', undefined, { numeric: true }),
      )
    },
  })
}

export function useInvitesAndCodes(pid: string | undefined, teamIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['invites-codes', pid],
    enabled: Boolean(pid) && enabled && teamIds.length > 0,
    queryFn: async () => {
      const [i, c] = await Promise.all([
        supabase.from('invites').select('*').eq('project_id', pid!).is('accepted_at', null),
        supabase.from('join_codes').select('*').in('team_id', teamIds),
      ])
      if (i.error) throw i.error
      if (c.error) throw c.error
      return { invites: i.data as Invite[], codes: c.data as JoinCode[] }
    },
  })
}

// ---- permission helpers (these mirror the database rules; the database is what actually enforces them)

export const isOwner = (b: Bundle) => b.me.role === 'owner'
export const isOwnerOrAdmin = (b: Bundle) => b.me.role === 'owner' || b.me.role === 'admin'
export const hodTeamIds = (b: Bundle) => b.myLinks.filter((l) => l.is_hod).map((l) => l.team_id)
export const isAnyHod = (b: Bundle) => hodTeamIds(b).length > 0

/** The level this person has in a section: edit needs the team's edit level plus HOD or an edit grant. */
export function levelFor(b: Bundle, key: SectionKey): AccessLevel {
  if (isOwnerOrAdmin(b)) return 'edit'
  let best: AccessLevel = 'none'
  for (const link of b.myLinks) {
    const row = b.access.find((a) => a.team_id === link.team_id && a.section === key)
    if (!row || row.level === 'none') continue
    if (row.level === 'edit' && (link.is_hod || link.can_edit)) return 'edit'
    best = 'view'
  }
  return best
}

export function myTeamNames(b: Bundle): string {
  const names = b.myLinks.map((l) => b.teams.find((t) => t.id === l.team_id)?.name).filter(Boolean)
  return names.length ? names.join(', ') : 'No team'
}

export function roleLabel(b: Bundle): string {
  if (b.me.role === 'owner') return 'Owner'
  if (b.me.role === 'admin') return 'Admin'
  return isAnyHod(b) ? 'HOD' : 'Member'
}
