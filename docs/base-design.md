# LineBoard 2.0: Base design (Step 1)

Status: proposed, awaiting owner approval. Follows docs/planning-document.md (sections 4, 5, 6, 7, 9, 22, 24-26).

## 1. What the base contains
Sign-up, login, password reset. Projects. Teams, roles, membership. Join codes and email invites. Permission rules enforced in the database. The scene record with locked numbers. The app shell (top bar, section list, phone bottom bar, banners, dialogs, empty states, light/dark). Nothing else: no script editor, shots, schedule or call sheets yet.

## 2. Stack
- Supabase (free tier, EU region): Postgres, Auth, Storage. Row Level Security (RLS) enforces every permission.
- Front end: Vite + React + TypeScript + Tailwind, TanStack Query, React Router (already in app/). Installable web app (vite-plugin-pwa).
- Sign-in in the base: email + password and password reset. Google, Apple and two-step verification come as their own features.
- Emails (invites, reset): a free outside SMTP service, because Supabase's built-in sender is capped at a few mails an hour.
- Prototype reuse: design tokens and component styles (planning doc part 2) and AppShell layout. The localStorage store is dropped.

## 3. Tables (all rows carry project_id; RLS filters on it)
- profiles: id (= auth user), display_name, email.
- projects: id, name, owner_id, status, created_at, last_active_at.
- teams: id, project_id, name, is_ad_team (flag so AD-specific rules, such as shot status, can find the team).
- team_section_access: team_id, section (script, shots, cast_crew, props, equipment, breakdown, schedule, call_sheets), level (none, view, edit). Defaults: view on schedule, call_sheets, cast_crew; none elsewhere.
- members: id, project_id, account_id, role (owner, admin, hod, member), invited_by, joined_at.
- member_teams: member_id, team_id, is_hod, can_edit (HOD-granted). A person may sit in two teams.
- invites: id, project_id, team_id, email, invited_by, expires_at, accepted_at.
- join_codes: id, team_id, code, expires_at, revoked_at. Joiners become Member (read-only).
- script_versions: id, project_id, version_no, locked.
- scenes: id (permanent, never reused), project_id, script_version_id, display_number (text: 42, 42A; null until the script is locked), heading, status (active, omitted), sort_order.
- scene_access: member_id, mode (none, selected, all). scene_access_scenes: member_id, scene_id.
- project_draft_counter: project_id, draft_no (goes up on every save, as in v1).
- Reserved for later features (created when their feature starts): shots, storyboard frames, cast_crew rows (with crew contact name/email), breakdown, schedules, shoot days, call sheets, props/equipment and cost records.

## 4. Permission rules (in the database, not the app)
Helper SQL functions (security definer, so policies stay short and fast): is_member(project), is_owner_or_admin(project), my_teams(project), can_view(project, section), can_edit(project, section, team_id).
- Owner/admin: see and edit everything in the project; only the owner deletes the project or transfers it.
- HOD: manages own team's members, join codes and edit grants.
- Member: reads sections their team allows; edits only if member_teams.can_edit is true for the owning team.
- Fixed sections: Overview and Scenes list (number + heading) readable by all members; Team and access owner/admin only; Export follows what each person can read.
- Scene text (and later scene elements) is readable only with scene_access = all, or the scene listed in scene_access_scenes, or owner/admin.
- Row ownership: later shared tables carry team_id; edit policy = can_edit(project, section, team_id).
- Tests: a SQL/vitest suite that calls the API as each role and proves outsiders and members cannot read or write what they should not (planning doc section 20).

## 5. Scenes and locking (base part)
- Scene id is permanent. Scenes have no number until the owner locks the script (lock_script numbers them 1..n). A number can be fixed by hand only while unlocked.
- Locked: a new scene is numbered by the database from its place in the script (42A between scenes, next whole number at the end, A1 before the first), cut scenes become omitted, existing numbers never change (enforced by triggers). Owner can unlock with a warning, and unlocking keeps the numbers. Revisions are tracked per scene after the lock (migration 0006).
- Draft matching, scene flagging and import come with the Script feature. The base only creates the structure and lets the owner add scenes by hand to test.

## 6. Joining flows
- Email invite: tied to one address; signing in with that email puts the person in the chosen team as Member.
- Join code: specific errors (expired, revoked, not found). Joiner is a Member of that team, read-only.
- Same verified email = same account. HOD/owner can grant edit access afterwards.
- Account deletion: blocked while the user owns a live project (lists them). Otherwise their rows become "Former member".

## 7. App shell and screens in the base
- Account: sign up, sign in, reset password, join with code, projects list with create, account settings (profile, password, delete account).
- Project: Overview, Scenes (list with locked/omitted display, add scene by hand), Team and access (teams, members, roles, edit grants, section matrix, join codes, invites). All other sections appear in the section list with a lock or an empty state, never hidden.
- System states in the base: offline banner (read-only cache comes later), permission denied/locked with reason and who can change it, empty states, loading and error states, dialogs (revoke code, delete project, leave with unsaved changes).
- Layouts: tablet landscape and portrait, phone with five-slot bottom bar, light and dark.

## 8. Build order inside the base
1. Create Supabase project (EU), env config, migrations folder in the repo.
2. Schema + RLS + helper functions + permission tests.
3. Auth screens and profile.
4. Projects list, create project, owner membership.
5. Teams, section matrix, members, edit grants.
6. Invites and join codes.
7. Scene record, locking trigger, Scenes screen.
8. App shell polish: all states, three layouts, dark mode.
9. Keep-alive ping and a first backup export (so the free tier is safe from the start).

## 9. Decisions needed from the owner before step 1
- Who creates the Supabase project: the owner (needs their account; free), or the owner shares the project URL and keys with me. I will not create accounts or spend money.
- Which free outside email service for invites and resets (suggestion: Resend free tier; to be confirmed against current limits).
- Ten default crew departments: confirm the list now (suggested: Direction, Production, Camera, Lighting and grip, Sound, Art, Costume, Makeup and hair, VFX, Post).
