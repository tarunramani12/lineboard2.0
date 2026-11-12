# Database: migrations and what each one added

Every permission is enforced in the database (row level security, security-definer functions and triggers), never only in the app. Migrations are plain SQL files in `supabase/migrations`, numbered in the order they must run. The owner applies each one by pasting it into the Supabase SQL Editor and replying "success". Claude never applies a migration on its own and never retries one that was declined. All 25 are applied to the live project.

## Migration list
| File | What it does |
|---|---|
| 0001_base | Accounts (`profiles`, `profile_private`), `projects`, `teams`, `members`, `member_teams`, invites, join codes, section access (`team_section_access`), scene access, helper functions (`is_member`, `is_owner`, `is_owner_or_admin`, `is_hod_of`, `can_view_section`, `can_edit_section`), `create_project` and its default teams, guard triggers. Design: `docs/base-design.md`. |
| 0002 to 0003 | Account deletion (blocked while you own a project; your rows stay as "Former member"); project delete fix. |
| 0004 to 0008 | Script: scene text per scene, renumbering, numbering at lock, import, apply a new draft. |
| 0009 to 0010 | Shots (number is computed: scene number, dash, place) and storyboard frames (photo layers plus pen strokes, private storage bucket). |
| 0011 | Hardening: trigger functions are not callable through the API. |
| 0012 | Transfer ownership to an admin. |
| 0013 | Breakdown: one form per scene and element lists in nine categories. |
| 0014 to 0016 | Cast and crew: one list per project, rows owned by a team, rows from the script are ordinary rows, deleted with the project. `system_switch_on()` reads the session switch `lineboard.system`. |
| 0017 to 0018 | Props and equipment split into two sections with their own access. |
| 0019 | Schedule: `schedules`, `shoot_days`, `schedule_scenes`, `cast_unavailable`. `create_project` redefined so Production and Direction edit Schedule and Call sheets by default. |
| 0020 | Join requests: code, then team choice, then approval by the team head, owner or admin. Members are added to Cast and crew automatically. `redeem_join_code` was removed. |
| 0021 | Schedule items, their scenes and costs (costs are visible only to the owner, admins and Production). |
| 0022 | Call sheets: `call_sheets`, `call_sheet_drafts`, `call_sheet_revisions`, `publish_call_sheet` (revision numbers, notes, snapshot). |
| 0023 | `schedule_shots`: different shots of one scene can be placed on different days. |
| 0024 | Email: sending identity per project and the `email_outbox` queue (see `docs/email.md`). |
| 0025 | Fix: a member who had edited a cast and crew row could not delete their account. `delete_my_account` now raises the system switch and clears the signed-in identity before the delete, and the cast and crew guard allows emptying "created by". Tested for Cast and crew only; shots, breakdown, schedule and call sheet editors may have the same problem (their guards were not tested). |

## Section keys
`script`, `shots` (also the storyboard), `cast_crew`, `props`, `equipment`, `breakdown`, `schedule`, `call_sheets`. The Scenes section was removed; `/scenes` redirects to `/script`.

## The system switch
Some trigger-protected columns can only change through a known function. Such a function runs `set_config('lineboard.system', 'on', true)` (local to the transaction), changes the data, and sets it back. Guards return early when the switch is on. It is not a security boundary against the database owner; it stops signed-in users from writing those columns directly, because users cannot set it for a statement that runs as them.

## Who may do what (short version)
The full rules are in the planning document section 6. In short: the owner can do everything and is the only one who locks the script, transfers or deletes the project and sets the email identity; admins manage people and teams; each team sees and edits only the sections it is given; heads of department (HOD) answer join requests for their team; costs in the schedule are visible only to the owner, admins and Production.

## Applying a migration
1. Claude writes the SQL, runs it against a local in-memory PostgreSQL (PGlite) in `supabase/tests`, and shows the owner the whole SQL in one block.
2. The owner pastes it in Supabase, SQL Editor, New query, Run, and answers "success" (or sends the error).
3. Claude verifies the result with a read-only query and runs the live checks.
Applying through the Supabase connector was declined once; do not retry it without a fresh, explicit yes.

## Backups
The free Supabase plan has no backups of its own. Owners and admins can download a full backup of a project from Export and settings (every table, the script and storyboard pictures, as one zip). Before charging customers, move to the paid Supabase plan for daily backups.
