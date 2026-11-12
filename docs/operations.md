# Operations: running, testing and keeping LineBoard safe

## Accounts and who does what
- GitHub `tarunramani12`, private repo `lineboard2.0`.
- Cloudflare: registrar and DNS for `lineboard.app`, and the Pages project `lineboard`.
- Supabase: the database, sign-in, storage and Edge Functions.
- Resend: outgoing email.
- Rule: Claude does not click through the Cloudflare, GitHub, Resend or Supabase dashboards. The owner does account steps. Claude may use the terminal tools the owner signed in for (`gh`, `wrangler`) and the Supabase connector for read-only checks and, with approval, deploying the Edge Function. If a permission prompt is declined, Claude stops and asks; it never works around it.

## Secrets: where each one lives (and nowhere else)
| Secret | Lives in |
|---|---|
| Supabase address and public (anon) key | `app/.env.local` on the owner's Mac (ignored by git); GitHub repo secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` (for the keep-alive job); baked into each production build. The anon key is public by design; the database rules protect the data. |
| Resend sending key | Supabase Edge Function secret `RESEND_API_KEY` only. |
| Supabase service role key | Provided to Edge Functions by Supabase. Never copied anywhere. |
| GitHub sign-in | macOS keyring through `gh auth login`. |
| Cloudflare sign-in | `wrangler login` token on the Mac. |
Never put a key or password in git, a doc, a chat message or a screenshot. `.gitignore` blocks `.env*` and `.mcp.json`. Before any commit, scan the staged files for key-like strings. If a key is ever exposed, rotate it at once (Resend: new key, replace the Supabase secret, delete the old one).

## Everyday commands
Run in `app`: `npm run dev` (port 5173), `npm run ipad` (open on the iPad over the local network), `npm test` (87 tests), `npx tsc -b`, `npx oxlint src`, `npm run build`.
Database tests, in `supabase/tests`: `npm test` runs 14 suites (permissions 70, script 93, shots 36, storyboard 30, ownership 16, breakdown 38, cast and crew 48, sections 5, schedule 41, join requests 41, items 30, call sheets 31, email 57, delete account 5). They run against PGlite, so they need no network and touch no real data.
Browser tests use `playwright-core` with the system Chrome against the dev server, using throwaway accounts that the test deletes (`delete_my_account` and project delete). Email tests use `delivered+label@resend.dev`.
Deploy: see `docs/hosting.md`.

## Keep-alive
The free Supabase project pauses after about a week without use. `.github/workflows/keepalive.yml` runs `scripts/keepalive.mjs` daily with one small read-only request (sign-in service answers 200, data service 401 without a user, exit code 0). It was run once by hand on 2026-11-12 and succeeded.

## Testing standard
Test before saying something works: database suites, vitest, tsc, build, then the real flow in a browser. Check phone width (390px) and the iPad. Targets are at least 44px; meaning is never shown by colour alone; no emoji and no exclamation marks in the interface; sentence-case labels; extensible dropdowns for list fields. Delete every test account and project.

## Costs (approximate; check the pricing pages)
- Now: about 10 to 15 euro a year for the domain. Cloudflare Pages, GitHub, Supabase free and Resend free cost nothing.
- Before charging customers: Supabase Pro about 25 dollars a month (daily backups, no pausing, higher limits). The free plan has no backups.
- When email grows: Resend Pro about 20 dollars a month. Raise the caps in `claim_outbox` at the same time.
- Stores later: Google Play 25 dollars once, Apple 99 dollars a year, through a Capacitor wrapper, only when customers ask.

## Known gaps and risks
- Offline: the sign-in page opens offline; reading project data offline is not built.
- Leaked-password protection is not switched on (may need a paid plan).
- The Edge Function and email queue only send when the app triggers them; there is no scheduled sender yet.
- Account deletion after editing is fixed for Cast and crew only (migration 0025); other sections are untested.
- `abuse@`, `support@` and `noreply@lineboard.app` have no inbox yet; replies to `noreply` are lost.
- No automatic build from GitHub; deploys are manual.
- Supabase's own auth mail still uses its built-in sender.

## What comes next, in order
1. Owner: test on iPad and phone, switch on leaked-password protection if available.
2. Call sheet recipient list and call sheet emails (`docs/email.md`, "Not built yet").
3. Scheduled sender and email invites.
4. Supabase auth mail through Resend; Cloudflare Email Routing for the role addresses.
5. Offline reading of project data.
6. Paid plans before charging; Capacitor and store listings.

## Phone and dual-screen review (how to repeat it)
Seed a project through the normal client API (an account, `create_project`, `import_script`, shots, `detect_cast`, a schedule with days, call sheets), then open every page with Playwright and system Chrome using touch and mobile emulation at these sizes: 390x844 and 360x640 (phones), 844x390 (phone landscape), 540x720 and 720x540 (dual-screen single panel), 1114x720 (dual-screen spanned). For each page record horizontal overflow, fields under 16px (iOS zoom), tiny text and screenshots. The 2026-11-13 pass found no sideways scrolling; the main fault was 15px form fields. Delete the test accounts afterwards (sign in as each and call `delete_my_account`, or with the owner's approval run a delete in the SQL Editor). Note: buttons are 30 to 36px tall with a 44px tap area made by an invisible `::after`, so audits that measure the box height will report them as small.
