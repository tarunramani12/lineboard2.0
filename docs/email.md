# Email: how LineBoard sends mail

Status: working for join requests and their answers. Call sheet emails, invites and Supabase's own sign-up mail are not built or not switched over yet (see the end).

## Design in one paragraph
Mail is sent through Resend from the verified domain `lineboard.app`. Each project can choose a sending name, so its mail comes from `{name}@lineboard.app` with the display name `"{Project display name} (via LineBoard)"`. Replies go (Reply-To) to the owner's real address. The app never sends mail itself and never holds the Resend key. Instead, database triggers write rows to a queue table (`email_outbox`); an Edge Function named `send-email` takes rows from the queue, sends them through Resend and reports back. The queue enforces daily limits and retries, so the free Resend plan (100 a day, 3,000 a month) is never exceeded.

## Accounts and settings (done by the owner)
- Resend account, free plan. Domain `lineboard.app`, region Ireland (eu-west-1), status Verified.
- DNS records in Cloudflare, all "DNS only" (added through Resend's one-time Cloudflare authorisation): CNAME `send` to `send.forge.rmta.net`, CNAME `rsend` to `rsend-euw1.forge.rmta.net`, TXT `resend._domainkey` (the signing key). They sit on subdomains, so the website records are untouched. Do not edit or delete them.
- Click and open tracking: off (they add DNS records and hurt delivery).
- Resend API key: created with "Sending access" for `lineboard.app`, pasted straight into Supabase, Edge Functions, Secrets, as `RESEND_API_KEY`. It was never pasted into chat, a file or git. To rotate it: create a new key in Resend, replace the secret in Supabase, delete the old key in Resend.

## Database (migration `0024_email.sql`)
- `projects.mail_id` (unique, lower case, 3 to 30 characters of a to z, 0 to 9 and hyphens, not starting or ending with a hyphen), `mail_name` (display name, up to 60), `reply_to` (up to 200), `mail_id_changed_at`, `email_paused`.
- `set_mail_identity(pid, new_id, new_name, new_reply)`: owner only. The id can change once every 7 days. Errors (plain messages are in `app/src/lib/errors.ts`): `mail_id_format`, `mail_id_reserved`, `mail_id_taken`, `mail_id_changed_recently`, `reply_format`, `not_allowed`.
- `mail_id_reserved()`: role addresses (support, admin, billing, noreply, security, postmaster, abuse, info, contact, and so on) and a short list of well-known brands, ignoring hyphens. Extend the array in a new migration when needed.
- Guard trigger `guard_project_mail`: owners cannot write the sending columns or `email_paused` directly; only `set_mail_identity` (it raises the `lineboard.system` switch) or staff in the SQL Editor (no signed-in user) can. `email_paused` is the emergency stop for one project.
- `email_outbox`: `project_id`, `kind` (`join_request`, `join_decision`, `call_sheet`, `invite`, `test`), `to_email`, `payload` (jsonb), `status` (`queued`, `sending`, `sent`, `failed`), `attempts`, `next_try_at`, `last_error`, `provider_id`, `created_at`, `sent_at`. Row level security: the owner and admins of the project can read their rows; nobody can insert, update or delete through the API.
- Triggers: a new `join_requests` row queues mail to the head of the requested team, or to the owner and admins when the team has no head (never to the requester); a request answered (approved or declined) queues mail to the requester.
- `claim_outbox(batch)` (service role only): returns up to `batch` due rows and marks them `sending`. Caps per UTC day: 40 per project and 80 for the whole app (the free plan allows 100). Rows over a cap are pushed to the next day. Paused projects are skipped. Rows stuck in `sending` for 10 minutes go back to the queue.
- `finish_outbox(id, success, provider, err)` (service role only): success marks `sent`; failure re-queues after 10, 40 and 90 minutes and marks `failed` after the fourth attempt.

## Edge Function `send-email` (source: `supabase/functions/send-email/index.ts`)
- Deployed with `verify_jwt` on: only a signed-in caller (or the anon key) can call it, and it can only send what is already in the queue. It cannot be used to send arbitrary text.
- Reads `RESEND_API_KEY`; Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` itself.
- Per row: finds the project's `mail_id`, `mail_name`, `reply_to` (falls back to the project name, `noreply`, and the owner's account email), builds the plain-text message, calls Resend with an `Idempotency-Key` equal to the row id (a retry cannot send twice), and calls `finish_outbox`.
- Messages are plain text, no exclamation marks, with a footer saying who sent it and where to report it (`abuse@lineboard.app`; this inbox does not exist yet, see below).
- Redeploy after any edit: through the Supabase connector (`deploy_edge_function`) with the owner's approval, or paste the file in the Supabase dashboard, Edge Functions, `send-email`.
- Sending is triggered by the app right after a request to join or an answer (`kickEmail` in `app/src/lib/email.ts`). Leftover rows (retries, rows held by a cap) wait for the next trigger. A scheduled call (for example every few minutes) is not built yet.

## In the app
- Export and settings, card "Send notifications as" (owner edits, admins see it): sending name, display name, reply address, a live preview of what recipients see, and a list of recent email with the state "Not sent yet", "Sending", "Sent" or "Could not send".
- Join requests (Account, Join) and decisions (Team and access, Requests to join) call `kickEmail` after they succeed.

## Tests
- `supabase/tests/email.mjs`: 57 database checks (identity rules, reserved and taken ids, who can read or write the outbox, recipients for requests and answers, claim, retry, caps, paused projects, project delete). Part of `npm test` in `supabase/tests`.
- `app/src/lib/email.test.ts`: sender preview.
- A browser test against the live database used Resend's test inboxes (`delivered+anything@resend.dev`) so no real person is emailed. Never test with `example.com` addresses against the live sender.
- One real test email was sent to the owner's own address and arrived.

## Limits and costs
- Resend free: 100 emails a day and 3,000 a month, one domain. The app's own caps (40 a project, 80 in total a day) sit under it. If real use gets near the limit, move to Resend Pro (about 20 dollars a month, check the current price) and raise the two numbers in `claim_outbox` in a new migration.
- Crew email addresses go through Resend, which stores data in the United States. Name Resend in the privacy policy (planning document section 20). Open question: whether addresses must stay in the EU.

## Not built yet
1. Call sheet emails: a recipient list before publishing, one email per revision, the PDF attached only for people without an account, the `call_sheet` kind composer in the Edge Function.
2. Email invites (the `invite` kind exists in the queue).
3. A scheduled sender, so retries and next-day rows go out without a user action.
4. Supabase's own sign-up, password-reset and magic-link mail through Resend: Supabase dashboard, Authentication, Emails, SMTP settings, host `smtp.resend.com`, port 465, user `resend`, password = a Resend key (a separate sending key, entered only in Supabase), sender `noreply@lineboard.app`. Until then Supabase's built-in sender is used, which is limited to a few mails an hour.
5. Real inboxes for `abuse@`, `support@` and `noreply@lineboard.app`: Cloudflare Email Routing (free) can forward them to the owner's address. Do this before relying on the footer line.
6. Later options: the owner's own sending domain as a paid extra; connecting Gmail or Outlook only if many owners ask.
