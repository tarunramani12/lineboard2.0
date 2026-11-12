// Sends queued email through Resend. The queue, the caps and the retries live in the database (migration 0024).
// This function can only send what is already in the outbox, so a signed-in caller cannot make it send anything else.
// Secrets: RESEND_API_KEY (set by the owner in Supabase). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'

const DOMAIN = 'lineboard.app'
const APP = 'https://lineboard.app'

type Row = { id: string; project_id: string | null; kind: string; to_email: string; payload: Record<string, any> }

function compose(r: Row): { subject: string; text: string } {
  const p = r.payload ?? {}
  switch (r.kind) {
    case 'join_request':
      return {
        subject: `${p.person} asked to join ${p.project}`,
        text: `${p.person} asked to join ${p.project} in the ${p.team} team${p.role ? ` as ${p.role}` : ''}.\n\nOpen LineBoard to approve or decline the request:\n${APP}\n`,
      }
    case 'join_decision':
      return p.approved
        ? { subject: `You are in: ${p.project}`, text: `Your request to join ${p.project} (${p.team}) was approved.\n\nOpen the project:\n${APP}\n` }
        : { subject: `Your request to join ${p.project}`, text: `Your request to join ${p.project} (${p.team}) was not approved. You can ask the team directly.\n\n${APP}\n` }
    case 'test':
      return { subject: 'Test email from LineBoard', text: 'This is a test email. If you can read it, sending works.\n' }
    default:
      return { subject: p.subject ?? 'Message from LineBoard', text: p.text ?? '' }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 })
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return Response.json({ error: 'RESEND_API_KEY is not set' }, { status: 500 })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: rows, error } = await db.rpc('claim_outbox', { batch: 10 })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  let sent = 0, failed = 0
  for (const r of (rows ?? []) as Row[]) {
    let fromName = 'LineBoard', fromId = 'noreply', replyTo: string | undefined
    if (r.project_id) {
      const { data: p } = await db.from('projects').select('name, mail_id, mail_name, reply_to, owner_id').eq('id', r.project_id).single()
      if (p) {
        fromName = `${(p.mail_name || p.name).replace(/[<>"\r\n]/g, '')} (via LineBoard)`
        if (p.mail_id) fromId = p.mail_id
        if (p.reply_to) replyTo = p.reply_to
        else {
          const { data: u } = await db.auth.admin.getUserById(p.owner_id)
          replyTo = u?.user?.email ?? undefined
        }
      }
    }
    const { subject, text } = compose(r)
    const footer = `\n--\nSent by LineBoard for a film project. If this email is not for you, ignore it or report it to abuse@${DOMAIN}.\n`
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': r.id },
        body: JSON.stringify({ from: `${fromName} <${fromId}@${DOMAIN}>`, to: [r.to_email], reply_to: replyTo, subject, text: text + footer }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { await db.rpc('finish_outbox', { oid: r.id, success: true, provider: body.id ?? null, err: '' }); sent++ }
      else { await db.rpc('finish_outbox', { oid: r.id, success: false, provider: null, err: `${res.status} ${body.message ?? ''}` }); failed++ }
    } catch (e) {
      await db.rpc('finish_outbox', { oid: r.id, success: false, provider: null, err: String(e).slice(0, 200) }); failed++
    }
  }
  return Response.json({ sent, failed })
})
