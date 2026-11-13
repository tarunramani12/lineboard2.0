# Who can do what (simplified)

Three kinds of people. The **Admin** runs the project (the person who created it; the app shows owner and admins as "Admin"). Each department has a **Head of department (HoD)**. Everyone else is a **Member**.

- **Admin**: does everything. Invites people by email and chooses, per invite, Head of department or Member. Can change any default owner and any team's access.
- **HoD**: edits every field the department owns. Decides which teammates can edit too (`member_teams.can_edit`, only if the team has write access to give). Gives teammates the same access level or lower, never higher than their own.
- **Member**: reads what the department reads; edits only what the HoD allows; asks for more with Request access.

## Request access
Export and settings lists every section with the level the person holds (No access, You can read, You can read and write) and lets them ask for read only or read and write. A member's request goes to the HoD of their team (an Admin can also decide it). A HoD's own request goes to the Admins only. If the HoD has no access to that section, the Admin decides. An approver gives at most the level they hold; Admins give either. Approval is a personal grant (`member_section_grants`).

## Default owners (the Admin can reassign any)
Project bible format: Camera. Moodboard: Direction. A shot, storyboard frame, breakdown element, cast and crew row, prop or equipment item: the team that created or manages it. Schedule and call sheets: Direction and Production. Costs: Admins and Production. Contacts: Admins and the Direction team (each person always sees their own row).

## What each team can open at the start
| Section | Direction | Production | Camera | Others |
|---|---|---|---|---|
| Script, Shot list and storyboard, Breakdown, Props | none | none | none | none |
| Equipment (each team sees only its own list) | owns | owns | owns | owns |
| Cast and crew | read | read | none | none (own row always) |
| Schedule, Call sheets | owns | owns | read | read (locked or published only) |
| Project bible | owns moodboard | read | owns format | read |

## Under the hood
Helpers every policy uses: `can_view_section`, `can_edit_section(pid, section, team)`, `is_owner_or_admin`, `can_manage_team`, `can_edit_bible_area`, `can_see_schedule_drafts`, `can_decide_access_for`. Known weak spot: a few rules find a team by its name (Production, VFX, Sound, Camera, Direction); renaming those teams breaks the rule.
