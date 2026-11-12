# Design brief for LineBoard 2.0

Design the interface for LineBoard 2.0, a web app for filmmakers that carries a project from script to call sheet. Design for tablets and phones first. Laptop browsers come for free. Produce a design system and the key screens, in light and dark themes, in tablet landscape, tablet portrait and phone.

## 1. What the product is

LineBoard 2.0 is a complete rebuild of a v1 tool that divided a script into shots. It is now for all filmmakers, not only cinematographers. It is aimed at people who cannot afford Final Draft, StudioBinder or Movie Magic. The pitch is a cheap, free-to-start path from script to call sheet, shared with a crew.

The chain is: script, scenes, shot list, storyboard, breakdown, cast and crew, props and equipment, schedule, call sheet.

The central idea the design must make visible: a scene is a permanent record. Its number locks (42, then 42A for an inserted scene, and OMITTED for a cut scene). Shots, breakdown, schedule and call sheets attach to the scene, so a script revision never breaks them.

## 2. Who uses it and where

- Directors, DOPs, ADs, producers, HODs and crew on and off set.
- Used on iPads, Android tablets and phones, often outdoors in bright light, in dim rooms, standing, one-handed, in a hurry.
- Most crew only read: they open the call sheet and check their scenes. A few people edit.
- Design for the reader first. The call sheet and shot list must be fast to scan at a glance.

## 3. Roles and permissions the UI must express

- Owner: creates the project, pays for the pass, invites people, controls everything.
- Admin: helps the owner, cannot delete the project or manage billing.
- HOD (head of department): leads a team, can add people to that team, edits their team's sections.
- First assistant: edits alongside the HOD in their team's sections.
- Member: read-only.
- Viewer: read-only, joined through a code.

Teams are created per project (for example Camera, Production, Art, Sound). For each team and each section the owner sets access to none, view or edit. Edit applies only to the HOD and first assistants. Defaults: view on schedule, call sheets, cast and crew. None elsewhere.

Script access is set per person by the owner: none, selected scenes, or the entire script. Everyone sees all scene numbers and headings. A new scene like 42A is not shared automatically with someone who holds selected scenes.

Row ownership: in shared sections, every row belongs to the team that created it. Only that team's HOD and first assistants can edit it. The owner or admin can move a row to another team.

The UI must make permissions obvious everywhere: always show whether I can edit this, which team owns this row, and why something is locked.

## 4. Priorities

- P0 (the pilot): sign up and sign in, join with a code, create a project, teams and roles, script paste or Fountain import turned into scenes with locked numbers, shot list per scene, storyboard image upload, read-only offline, row ownership between two teams (Camera and Production).
- P1 (first public release): the call sheet and schedule, the script writing box and PDF import, script PDF export, email alerts for call sheet changes, the project pass purchase.
- Later, show only as placeholders if needed: full screenplay editor, stripboard, budget, location photos.

## 5. Information architecture

Account level:
- Sign up, sign in, join with a code.
- Projects list.
- Account settings.

Inside a project, a persistent navigation (a sidebar on tablets, a bottom bar or menu on phones) with:
- Overview
- Script
- Scenes
- Shot list
- Storyboard
- Breakdown
- Cast and crew
- Props and equipment
- Schedule
- Call sheets
- Team and access
- Export and settings

Each section shows only what the user may see. Sections the user cannot access are hidden or shown as locked, not broken.

## 6. Screens to design

### Account
- Sign up and sign in with email and password. No social sign-in in the pilot.
- Join with a code: a short field, clear success and error states ("code expired", "code revoked").
- Projects list: cards for each project showing name, my role, and status. Statuses: Free, Pass active until a date, Read-only until a date, Deletes on a date. A button to create a project. A free-tier indicator ("1 of 1 free project used").
- Account settings: profile, password, delete account. Deleting an account is blocked while the user owns a live project. The screen must explain "transfer or delete your projects first" and list them.

### Overview
- A project dashboard: scene count and locked state, next shoot day, latest call sheet status, who is on the project, a tile for any alerts (script unlocked, stale links, project nearing read-only).
- A lifecycle banner for passes: active for 12 months, read-only for 12 more, then deleted. Show monthly reminders and a weekly one in the final month as in-app banners too.

### Script
- A text box for writing in Fountain, with highlighting for scene headings, action, character names and dialogue. Industry-style screenplay formatting in the script view.
- A clear unlocked or locked state and a "Lock script" action. Explain what locking does: scene numbers freeze and new drafts are matched to existing scenes.
- Only the owner and chosen writers can edit, and only one at a time. Show "Anna is editing" to others, who read.
- Import: plain text, Fountain, PDF, Word.
- Import review screen, shown before anything saves: the detected scenes in a list, with the ability to fix a heading, merge or split scenes, and confirm. Flag low-confidence detections, especially from PDF and Word.
- New draft matching screen for revisions: old scenes on one side, new on the other, matches, inserted scenes (42A), omitted scenes, and an owner approval step. Nothing downstream changes automatically.
- Export the script as a PDF in standard screenplay layout with scene numbers.

### Scenes
- A list of scenes: display number (42, 42A), heading, status (active, omitted), shot count, a lock icon.
- Scene detail: heading, script excerpt for people with access, linked shots, breakdown, schedule day.
- A message for people with selected-scene access: their scenes show the text, the others show number and heading only.

### Shot list
- Shots grouped by scene. Shot numbers count within a scene (42-1, 42-2). They renumber freely while planning and lock once a shot list or call sheet is published.
- Each shot shows: description, shot size and movement, lens, owning team, status, an optional link to a script passage.
- A stale link badge when the linked passage changed in a revision. Nothing moves silently.
- Reordering, adding, editing inline. Row ownership shown on every row.
- Conflict dialog when two people edit the same row: it shows the other change and offers keep mine, keep theirs, or merge.

### Storyboard
- A grid of frames per scene and per shot. Upload an image, with compression on upload.
- A size meter against the project's image cap.
- On the free tier, storyboards are not available. Design a clear, polite locked state that offers the project pass, without nagging.
- Offline, storyboard frames are blank. Design the empty state and an "export as PDF before going to location" prompt.

### Breakdown
- Elements per scene (cast, props, wardrobe, vehicles, notes), each with an owning team.

### Cast and crew
- Names, roles and call times are visible to everyone with view access.
- Phone and email are restricted to the owner, admin and the AD team. Others see a lock where the contact would be.
- Rows belong to teams. A deleted member's rows show "Former member", and the HOD can reassign them.

### Props and equipment
- Per project lists with quantity, owning team, and linked scenes. A new item should default to a sensible quantity, not zero.

### Schedule
- A list of shoot days. Each day has a date, location and the scenes shot that day.
- Assign scenes to days by scene ID, with a clear view of unscheduled scenes.
- No stripboard and no cast availability rules in the first release.

### Call sheets
- Auto-filled from the shoot day: date and day number, location, general crew call, scenes of the day, cast with call and makeup times, crew by team with call times, notes, nearest hospital.
- The AD team edits and publishes.
- After publishing, changes create a revision. Show a revision number and mark changed lines.
- View in the app for people with accounts. Export a PDF for anyone without one. The PDF must look like a professional call sheet and print cleanly on A4 and US Letter.
- Weather is optional and not in the first release.

### Team and access
- Teams list and team detail: members, roles, which sections the team can view or edit.
- A permission matrix: teams by sections, with none, view or edit.
- Script sharing: per person, none, selected scenes or the entire script, with a scene picker.
- Join codes: generate a code for a team, set an expiry, revoke it. Code joiners start as viewers. The owner promotes people to editor.
- The editor cap is shown: "3 of 5 editors" on a free project, unlimited on a pass. Pending invitations count toward it.

### Export and settings
- Export per section as PDF, and a full project backup file for the owner and admin. Other members export only what they can see.
- Project lifecycle and pass status, with a clear "Buy project pass" action.
- Delete project, with a confirmation that asks the owner to export first.

### Pass purchase
- A simple screen: the project pass is $10 for one project for 12 months, with unlimited editors, images and no scene cap. The crew never pay. Checkout happens on the web. Design the before, during and after states, and the confirmation.
- Free tier summary: 1 project, up to 5 editors, unlimited viewers, 15 scenes counting every scene ever created, text only, no storyboards.

## 7. System states the design must include

- Offline: a persistent but quiet banner. Read-only text from the cache. No images.
- Held draft: when the connection drops while editing, show "Not saved yet, will send when you are back online" next to the field.
- Edit conflict dialog.
- Permission denied or locked: why, and who can change it.
- Free tier limits: scene cap reached, editor cap reached, storyboards locked. Each with a calm explanation and the pass offer.
- Read-only project after the pass ends, and the final month before deletion.
- Empty states for every section, with the next step.
- Loading and error states, including a failed upload and an oversized image.
- Import failures and low-confidence detections.

## 8. Visual and interaction direction

- Calm and professional. Clear enough for a glance on a bright set, comfortable in the dark. Provide light and dark themes with high contrast.
- Tablet first. Large touch targets (at least 44 points), readable type, generous spacing, controls reachable by thumb.
- Film conventions where they help: the script in a screenplay-style monospaced layout, the call sheet in a familiar printed-sheet structure. The rest of the app uses a modern interface typeface.
- One accent colour, plus status colours for locked, revised, omitted, stale and conflict. Never use colour alone to carry meaning.
- Show structure plainly: a scene is a card or row with its number prominent.
- Keep text short and plain. Avoid jargon outside film terms.
- Do not imitate Final Draft, StudioBinder, Celtx or Movie Magic. Do not use their logos, names or layouts. Propose two distinct visual directions first, then develop the one chosen.
- There is no logo or brand yet. Suggest a wordmark for "LineBoard".

## 9. Accessibility

- Text contrast of at least 4.5 to 1. Support dynamic type sizes. Every control reachable by keyboard and screen reader.
- Do not rely on hover. Everything must work on touch.

## 10. Deliverables

- The design system: colour and type tokens for both themes, spacing, components (buttons, inputs, cards, tables, tabs, banners, dialogs, badges, the permission indicator, the scene number chip).
- High-fidelity screens for P0 and P1 above, in tablet landscape, tablet portrait and phone.
- The import review, revision matching, conflict dialog, call sheet (screen and PDF) and permission matrix shown in full detail.
- A short note on how the navigation adapts from tablet to phone.
