import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export interface MyJoinRequest {
  id: string; status: 'pending' | 'declined'; project_id: string; project_name: string; team_id: string; team_name: string
  role: string; created_at: string; decided_at: string | null; has_hod: boolean
}
export interface PendingJoinRequest {
  id: string; team_id: string; team_name: string; role: string; created_at: string; name: string; email: string; has_hod: boolean
}
export interface CodeLookup { project_name: string; team_id: string; teams: { id: string; name: string }[] }

/** Who will answer a request: the head of the team when there is one, otherwise the owner. */
export const whoDecides = (r: { has_hod: boolean; team_name: string }) => (r.has_hod ? `the head of ${r.team_name}` : 'the project owner')

export function useMyJoinRequests(userId: string | undefined) {
  return useQuery({
    queryKey: ['my-join-requests', userId],
    enabled: Boolean(userId),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_join_requests')
      if (error) throw error
      return (data ?? []) as MyJoinRequest[]
    },
  })
}

export function usePendingJoinRequests(pid: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['join-requests', pid],
    enabled: Boolean(pid) && enabled,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_join_requests', { pid })
      if (error) throw error
      return (data ?? []) as PendingJoinRequest[]
    },
  })
}
