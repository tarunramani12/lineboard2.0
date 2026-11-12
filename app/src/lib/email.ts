import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Ask the sending function to deliver what is waiting. It sends only what is already queued, so this is safe to call any time. */
export function kickEmail() {
  void supabase.functions.invoke('send-email', { body: {} }).catch(() => undefined)
}

export const MAIL_DOMAIN = 'lineboard.app'

/** The sender line people will see, for the preview in settings. */
export function senderPreview(p: { name: string; mail_id: string | null; mail_name: string }) {
  const id = p.mail_id || 'noreply'
  const shown = (p.mail_name || p.name).replace(/[<>"]/g, '')
  return `${shown} (via LineBoard) <${id}@${MAIL_DOMAIN}>`
}

export interface OutboxRow { id: string; kind: string; to_email: string; status: 'queued' | 'sending' | 'sent' | 'failed'; attempts: number; last_error: string; created_at: string; sent_at: string | null }

export function useOutbox(pid: string, enabled: boolean) {
  return useQuery({
    queryKey: ['outbox', pid],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('email_outbox').select('id, kind, to_email, status, attempts, last_error, created_at, sent_at').eq('project_id', pid).order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return (data ?? []) as OutboxRow[]
    },
  })
}

export const KIND_LABEL: Record<string, string> = { join_request: 'Request to join', join_decision: 'Answer to a request', call_sheet: 'Call sheet', invite: 'Invite', test: 'Test' }
export const STATUS_LABEL: Record<OutboxRow['status'], string> = { queued: 'Not sent yet', sending: 'Sending', sent: 'Sent', failed: 'Could not send' }
