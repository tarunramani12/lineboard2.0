# LineBoard to-do list

The single list of open tasks. Read it at the start of every session, tick items when done, add new ones as they come up. Never put keys, secrets or passwords here.

Last updated: 2026-11-15

## Google sign-in: LIVE (published by the owner 2026-11-15; button switched on and deployed)
The Continue with Google button shows on Sign in and Create account (`VITE_GOOGLE_SIGNIN=on` in `app/.env.local`). Supabase answers with a redirect to Google.
- [x] Privacy and terms pages written short (only what is needed and legal; `/privacy`, `/terms`, `app/src/pages/Legal.tsx`), linked under the sign-in and sign-up cards. DEPLOYED 2026-11-15 together with the new Overview, Locations name and unstretched phone buttons; both pages answer 200 on lineboard.app. Not committed.
- [x] Contact email on the privacy and terms pages is `lineboard.app@gmail.com` for now (set in `app/.env.local` as `VITE_CONTACT_EMAIL`, DEPLOYED 2026-11-15).
- [ ] Create `support@lineboard.app` (Cloudflare, lineboard.app, Email, Email Routing: enable, create address `support`, destination `lineboard.app@gmail.com`, confirm the email Cloudflare sends, send a test). THEN change the contact everywhere it is used: `VITE_CONTACT_EMAIL` in `app/.env.local` (then redeploy), Google Auth Platform (Branding: user support email; Contact information: developer contact email, if Google allows an address that is not the account's own), and any other page or setting that shows the Gmail. Also route `abuse@` and `noreply@` if wanted (see `docs/operations.md`, known gaps).
- [ ] Owner, after the pages are live: Google Auth Platform, Branding: home page `https://lineboard.app`, privacy `https://lineboard.app/privacy`, terms `https://lineboard.app/terms`, authorized domain `lineboard.app` (leave `supabase.co` out). Do NOT upload an app logo (a logo can trigger Google's review). Save. If Google asks to verify the domain `lineboard.app`, that is done in Google Search Console with a TXT record in Cloudflare.
- [x] Owner published the Google app
- [ ] Owner tests with a second Google account (owner does this himself). Remember a new Google user can sign in but cannot create a project unless their email is in `project_creators`.
- [x] Button switched on and deployed 2026-11-15
- [ ] Optional, later: Google may show "Google hasn't verified this app" to new users. Plain meaning: Google has not checked LineBoard itself. For apps that only ask for name and email it is usually not needed, but if users see the warning you fill in Google's verification form (free, takes days to weeks). Not needed to start.
- [ ] Before selling LineBoard: add a German Impressum page (name and address of the operator), have a lawyer read the privacy and terms drafts, and settle who is the data controller for crew details
- [ ] Apple sign-in stays off until the owner pays for the Apple developer account (not planned)

## Project creation by invitation (live 2026-11-14, temporary until payments are decided)
- Rule is ON and stays on until the owner has decided the payments, plans and prices: only emails in table `project_creators` can create projects (1 each by default; `unlimited` for the owner's two emails). Add someone: Supabase dashboard, Table Editor, `project_creators`, Insert row, type the email, Save. Remove the rule later: `update app_settings set project_creation_restricted = false`.
- [ ] Owner: delete the leftover test row `lbcreate1794660460271@example.com` in `project_creators` (my cleanup SQL was declined; its account and project were already deleted)
- [ ] Payments proposal is stored for later discussion in the plan file `/Users/tarun/.claude/plans/lets-plan-a-location-snuggly-robin.md` (provider recommendation, project pass, limits, legal pages)
- [ ] Watch Supabase free storage: new projects now default to a 350 MB picture limit

## Locations section (approved plan: /Users/tarun/.claude/plans/lets-plan-a-location-snuggly-robin.md)
Built and browser-tested 2026-11-14: database (0038, 0039 applied), page, photos with drawing, scenes, availability, costs, lock, maps, weather function deployed, call sheet blocks, PDFs, backup. Deployed, NOT committed.
- [x] Real browser tests done 2026-11-14 (desktop and phone, live database, test accounts deleted): 16 checks on the Locations page and 10 on a two-location call sheet, weather function answered with live MET data
- [x] Deployed 2026-11-14 (lineboard.app serves the new build)
- [x] Committed and pushed 78a5037 (2026-11-15)
- [ ] Still to look at on a real phone: the long Locations dialog (buttons are at the bottom of a scrolling form)
- [ ] Later: calendar download (.ics) for locations
- [ ] Keep an eye on map use (OpenStreetMap light use): review when LineBoard has real users, move to a paid tile provider if it grows
- [ ] Before selling LineBoard: confirm MET Norway terms and usage limits (credit line, header, cache rules); the weather function sends User-Agent `LineBoard/1.0 (https://lineboard.app)`
- [ ] Future: budget and accounting read `location_costs`
- [ ] Shoot day booking: `location_availability.day_id` exists but nothing sets it yet (Schedule could mark a day booked automatically)

## Payments and plans (decided 2026-11-15, see summary.md and the plan file is-there-a-free-rustling-feigenbaum.md)
- [x] Plan ladder locked: Free 40 MB, Micro 150 MB EUR 1.49, Basic 1 GB, Standard 2 GB, Plus 4 GB
- [x] Egress and profit calculator built (euros, per plan): `calculations/egress-calculator.html`
- [ ] Check on the live pages: Polar current plan fees, competitor pricing pages, today's USD to EUR rate (Supabase and Paddle prices checked 2026-11-15); replace the calculator's estimates with real usage after launch
- [ ] Measure real storage per scene to confirm the "about N scenes" labels
- [ ] Settle: provider, refund rule for small payments, Micro yearly option, Steuerberater and business registration
- [x] Picture cache built and tested locally 2026-11-15 (not deployed; check with real files after deploy)
- [x] Migration 0041 applied and everything deployed 2026-11-15. [ ] Owner: open /usage signed in and check the numbers; commit and push when the owner says so. Usage dashboard for the app owner (owner decision 2026-11-15: build whatever data is available, found, fetched or calculated to keep track of the app; add more as new data becomes available), a page inside LineBoard a page inside LineBoard gated by an owner list (database functions refuse everyone else). V1 from existing data: accounts (total, new, last sign-in), projects, admins and projects per admin, people per project, storage per project and per admin. V2: egress log (who opened which project's pictures, count and bytes; with the picture cache it shows requests, not Supabase's billed bytes) plus a cost estimate or Supabase usage figures (check what the management API exposes). V3: plan and income after the payment provider is chosen. Needs a privacy page line about usage logging. Open question: also a per-customer "my usage" view (storage against plan limit), which the plan limits need anyway.
- [x] Install banner (Android button, iPhone hint) and manifest id/categories built, tested in Chrome and DEPLOYED 2026-11-15
- [x] Usage-bar change (storage bars only for project owner and admins) deployed 2026-11-15; owner to check as a member
- [ ] Owner to check on real devices: install banner (iPhone, iPad, Android), sign out then sign in lands on the home page, Usage link now in Account settings (App admin section)
- [x] Read-only offline project data built, tested and deployed 2026-11-15
- [ ] Owner to check on a real device: open a project online, turn on airplane mode, reload; the pages opened before should show; the Shot list and Storyboard fold buttons stay on screen while scrolling
- [ ] PWA: optional manifest screenshots
- [ ] Later: show 'saved copy' and its age on pages while offline; a friendlier message instead of 'Loading' for pages never opened before, then later Capacitor wrapper and store accounts if there is demand

- [ ] Check on a real phone after deploy: Script page (Lock and Set target runtime in the hamburger menu, sticky Scenes button) and the Shot list fold button beside the info

## Scene search (built and DEPLOYED 2026-11-15, not committed)
- [x] Search on Shot list, Storyboard (floating button) and Script (a bar under the top bar: Scenes button, search, zoom pill at the far right) (`components/SceneFind.tsx`, `lib/sceneSearch.ts`): the cross clears and closes; matches scene number and heading, and on Script also the scene text (only scenes the person may read)
- [ ] Owner: delete the leftover test row `lbfindtest@example.com` in `project_creators` (my cleanup SQL was declined; the test account and project were deleted)
- [ ] Owner to look at it on a real phone and in dark mode (Chrome checks passed at 1280 and 390 wide)
- [ ] Filter button next to the search (owner asked to keep this for later): INT / EXT, DAY / NIGHT, DAWN / DUSK from the heading (`headingParts()` in `lib/schedule.ts`), plus "Revised" on Script and "No shots yet" on Shot list and Storyboard; OR within a group, AND across groups, combined with the search; badge on the button shows how many are on

## Shots page (merged 2026-11-16)
- [ ] Owner to check on a phone and a tablet: the rows with pictures, opening a shot (Details and Frame tabs), drawing a frame, Mark done and Reopen, both PDFs, the picture size limit, drag to reorder
- [ ] Tablet portrait (640 to 899 px): the size, lens and team cells stack on separate lines in a shot row; put them on one muted line like on a phone

## Static page header (built 2026-11-16, NOT deployed, NOT committed)
- [x] Deployed 2026-11-16 (deployment 2ca81194). [ ] Owner: say "commit" to save the page header, design pass and page bar to GitHub
- [ ] Owner to check every page on a phone and a tablet after deploy: Script, Shot list, Storyboard, Cast and crew, Locations, Props, Equipment, Breakdown, Project bible, Schedule, Call sheets, Team and access, Overview, Projects, Account settings, Usage
- [ ] Delete the unused `.lb-page-head` CSS rules
- [ ] Decide: keep the Props and Equipment copy row and the Call sheet publish buttons in the page content, or move them into the hamburger

## Design consistency fixes (2026-11-16)
- [x] Shared Dialog in all pages; tokens for the hard-coded colours; one pen palette; round chips and loose radii; duplicate CSS removed; heading classes and wording (deployed)
- [x] Opaque page bar (scene list, fold all, search, zoom) on Script, Shot list and Storyboard (deployed)
- [x] Committed and pushed df131f4 (2026-11-16)
- [ ] Move the repeated inline styles (CallSheets 31, TeamAccess 29, Schedule 17, Items 15) into classes
- [ ] Owner to check on devices: the page bar on the Script, Shot list and Storyboard (phone and tablet), the pop-up windows (Escape, phone), the round chips now with small corners

## Later / waiting
- [ ] Delete the unused `u6835386282@id.gle` Google account (myaccount.google.com, Data & privacy, Delete your Google Account). Owner, after the Gmail account exists.
- [ ] Optionally shut down the old Google Cloud project `lineboard-514708` under the personal Google account (IAM and Admin, Settings, Shut down) once Google sign-in works.
- [ ] Test data: 14 `lb*@example.com` accounts and 5 test projects stay until ALL testing is finished (owner decision 2026-11-14). Then delete the projects (with storage files) first, then the accounts.
- [ ] Leaked-password protection: needs Supabase Pro plan. Switch it on when upgrading (Authentication, Sign In / Providers, Email).
- [ ] Optionally set a `support@lineboard.app` forwarding address (Cloudflare Email Routing) for the Google support email.
- [ ] Check the phone controls pass on a real phone (deployed 2026-11-14), then say "commit" to save it to GitHub (not committed yet).
- [ ] Real iPad and phone review still open from earlier sessions.

## Done recently
- [x] Supabase Auth URL settings confirmed by the owner.
- [x] Phone controls pass deployed (three-line menus, icon buttons, lock icon, zoom pill, dropdown carets).
