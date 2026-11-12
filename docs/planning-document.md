# LineBoard 2.0: Planning Document

Owner: Tarun Ramani. Audience: Claude Code, as the build brief for LineBoard 2.0.

This document states what LineBoard 2.0 must do and how it must look. It does not say how to build it. Everything here is built, one feature at a time, base first.

## How to read this document

- There is no demo and no pilot. The goal is a running application, built step by step: the base first, then one feature at a time.
- There is no later stage. Everything in this document is built.
- "Must" is a requirement. "Decided" means the owner has chosen it. "Open" means the owner has not decided yet: ask before building it.
- Pricing, caps and limits are parked (section 21). Build with no caps and no paywalls for now.
- Part 2 is the design system. Every screen follows it.

## 1. Product

LineBoard 2.0 takes a film from script to call sheet, shared with the crew. The chain is: script, scenes, shot list, storyboard, breakdown, cast and crew, props and equipment, schedule, call sheet.

It is for filmmakers of every kind who cannot afford Final Draft, StudioBinder or Movie Magic.

LineBoard 2.0 is a complete rebuild of LineBoard v1, a single HTML file that runs on an iPad. v1 has no server, no accounts and no cloud, and a project is a zip file the user saves by hand. v1's core idea was line-based shot division, where the DOP marks script lines to make shots. 2.0 keeps v1's planning tools and adds accounts, teams, shared projects, scheduling, call sheets and script revisions. It is a new application that reuses v1's ideas, not an extension of v1's code. v1 projects are not migrated: the user re-imports the script and rebuilds the shots.

**What makes it different.** Writing tools are free or cheap already. Production planning is where the paywalls start. The gap LineBoard fills is a free or cheap tool that takes a project from script to shot list to schedule to call sheet, with a crew, without a monthly plan per person. The writing editor will not be the reason people choose it. The connected pipeline will.

### Goals

- A project owner can invite people and control which departments each person sees.
- Everything v1 does keeps working in the new model.
- Changes made by one person show up for others without any file transfer.
- A crew member can open a call sheet on a phone, in bright sun or in a dark room, and read it at a glance.

### Who uses it and where

- Directors, DOPs, assistant directors (ADs), producers, Art directors, makeup and hair HoDs, heads of department (HODs) and crew, on set and off set.
- iPads, Android tablets, phones and laptops. Often outdoors in bright light, in dim rooms, standing, one-handed, in a hurry.
- Most people only read. They open the call sheet and check their scenes. A few people edit.
- Design for the reader first. The call sheet and the shot list must be fast to scan.

### Non-goals

- A separate native rewrite for iPad, iPhone or Android. The web app is the one app, and the store releases are that same app.
- AI-generated storyboard art.
- Matching the full feature depth of Final Draft or Celtx.
- Public share links and guest access. Everyone who sees anything has an account. A PDF covers people without one.
- Magic-link sign-in.
- Migration of v1 projects.
- A lifetime account, and per-user subscriptions.

## 2. Platforms and reach

- The app runs on tablets and phones, on iOS and Android, and in laptop browsers.
- It is delivered as a web app that can be saved to the home screen, and it is also released through the Apple App Store and Google Play as the same app, not a separate native rewrite. Store accounts cost money (Apple about 99 USD a year, Google about 25 USD once), so ask the owner before anything is paid for.
- Tablet is the primary layout. Phone and laptop must work fully.
- No push notifications. Home-screen web apps in the EU lose push on iOS, so email is the way to alert people (section 18).

## 3. Decided constraints

These are the owner's decisions. Do not change them without asking.

- All data lives in one hosted backend. Users never choose a database, a cloud or a storage account.
- The owner has chosen Supabase as that backend (Postgres, authentication, file storage). Decided: free tier in an EU region for the build, with a keep-alive against pausing, an early backup export and an image cap per project. The paid plan is revisited before real shoots, and nothing is paid for without the owner's approval.
- Permissions must be enforced on the server, not only hidden in the interface. A person who calls the backend without the app must get nothing they should not see.
- Sign-in is by email and password, plus Google and Apple sign-in. Two-step verification is optional for everyone.
- People join a project with a join code or an email invite.
- Offline use is read-only (section 17).
- The owner chooses free options wherever a tool or service must be picked, and says so before anything costs money.
- The app has no tracking cookies and no usage tracking beyond server logs.

## 4. Build approach

The application is built in steps. Each step is finished and working before the next starts.

### Step 1: the base

One central database holds every piece of information about a project or a film, small or large. Everything hangs off the project, and everything downstream of the script hangs off a scene that never changes. The base contains:

- Sign-up, login and password reset.
- Projects.
- Teams, roles and membership.
- Join codes and email invites.
- The permission rules, enforced by the backend.
- The scene record with locked numbers.
- The design system's app shell: top bar, section list, phone bottom bar, banners, dialogs, empty states.

The base must be designed so that every later feature stores its information in the same central database and respects the same permissions.

### Step 2 onward: one feature at a time, until everything is built

Features are: script writing and import (including FDX), shot list, storyboard, cast and crew, breakdown, props and equipment per schedule, schedule with stripboard, call sheets with the shoot-day shot list, exports, email alerts, Google and Apple sign-in, two-step verification, a reusable cast and crew library, store releases, and a version studios can host themselves. Every feature in this document is built. The owner chooses the order of features and will say which comes first. Do not start a feature without being told. When a feature is chosen, build it completely: every screen, every state in section 22, and its permissions. If any new feature is discussed, this document is updated and the feature is planned in detail before building.

## 5. The central database: what it must hold

Everything hangs off a project. Everything downstream of the script hangs off a scene ID that never changes. Every row carries its project and its owning team, and permissions filter on both.

| Entity | Belongs to | What it must hold |
|---|---|---|
| Account | Nothing | Email, password. One account can own several projects and belong to several others, with a different role in each |
| Project | Owner account | Name, owner, status, dates (created, last active) |
| Team | Project | Name, access level (none, view, edit) per section |
| Member | Project and team | The account, the role (owner, admin, HOD, member), and an edit-access flag for the team's sections, granted by the HOD |
| Crew contact (no account) | Project and team | Full name and email, held on a cast and crew row, so a person without an account can receive call sheets. Links to an account automatically if they join with the same verified email |
| Join code | Team | Expiry, revoked flag. A person who joins with it is read-only |
| Script version | Project | Version number, locked flag. The script is stored as scenes and typed elements (not one block of text), so per-scene access can be enforced by the backend. The full text is assembled from them |
| Scene | Project | Permanent ID, display number (42, 42A), heading, status (active, omitted) |
| Script access | Member | The scene IDs they may read, or the whole script |
| Shot | Scene | Number within the scene, owning team, status (planned, done, dropped), shot size, shot type, lens, movement, cast needed, crew needed, VFX required, sound effects required, special effects, action, silent flag, notes, optional script passage reference with a stale flag, other fields as they are discussed and planned |
| Storyboard frame | Shot | Image, compressed size, drawing layers |
| Cast and crew row | Project | Name, role or character, department, call time, makeup time, phone, email, owning team, other fields as they are discussed and planned |
| Breakdown entry | Scene | Location, date, synopsis, cast, crew, extras, props, equipment, wardrobe, hair and make-up, sound, special effects, notes, owning team, other fields as they are discussed and planned |
| Schedule/Block | Project | Name, start date, end date. Holds its shoot days and its prop list and its equipment list, other fields as they are discussed and planned |
| Shoot day | Schedule | Date, location, scene IDs, other fields as they are discussed and planned |
| Call sheet | Shoot day | Revision number, published flag, changed lines, notes, nearest hospital, other fields as they are discussed and planned |
| Prop list and equipment list | Schedule | One of each per schedule. Items: name, quantity (at least 1), owning team, notes, status, supplier, other fields as they are discussed and planned |
| Item cost record | Item | Rental price or cost. A separate record visible only to Production, the owner and admin, other fields as they are discussed and planned |
| Draft number | Project | Goes up on every save, as in v1 |

**Rules that hold across entities**

- Shots, breakdown entries and shoot days point to scene IDs, never to scene text or numbers. A script revision must not break them. Any field open in any page must show the same values.
- A shot's script passage reference is optional and is only a pointer. If the passage changes in a revision, the link is marked stale. Nothing moves silently.
- Shot numbers count within a scene (42-1, 42-2). They may renumber freely while planning, and lock once a shot list or call sheet is published.
- Cast and crew rows belong to a project. Props and equipment belong to a schedule. A reusable cast and crew library lets a person or crew member be reused across projects, and items can be copied from another schedule.
- Deleting a project deletes its files, images and rows. The owner can always export first.

## 6. Roles, teams and permissions

### How a project is set up

1. A person creates an account.
2. The account creates a project and becomes its owner.
3. The owner creates teams for the project, one per department (for example Camera, Production, Art, Makeup and hair, Sound, VFX), and decides which sections each team can see and edit.
4. The owner invites people from their own team and the head of department (HOD) of each other team.
5. Each invited HOD, and each person the HOD has given edit access, adds people to their own team.
6. The HOD of each team decides who on the team gets edit rights in that team's sections: one person or several. Everyone else on the team is read-only (Member).

### Roles

| Role | Sees | Edits |
|---|---|---|
| Owner (the person who created the project) | Everything | Everything, including invitations, permissions, deleting the project and managing billing |
| Admin | Everything the owner sees | Everything the owner edits, except deleting the project and managing billing. Admins manage teams and people |
| HOD (head of department) | Their team's allowed sections | Their team's allowed sections, can add people to their own team, and decides which team members get edit access |
| Member (joined by invite or code) | Their team's allowed sections | Nothing, unless the HOD has granted them edit access in their team's sections. Anyone holding that grant can also add people to their own team |

There is no separate first assistant or Viewer role. Edit access is a per-person grant by the HOD. For the AD team, the HOD grants it to the 1st AD, the 2nd AD or others. Those holders can change shot status and publish call sheets.

| Action | Owner | HOD | Member with edit access | Other members |
|---|---|---|---|---|
| Create teams and set team access | Yes | No | No | No |
| Invite people | Anyone | Own team only | Own team only | No |
| Grant edit access in the team | Yes | Own team only | No | No |
| Edit the team's allowed sections | Yes | Yes | Yes | No |
| View the team's allowed sections | Yes | Yes | Yes | Yes |

### Section access

- For each team and each section, the owner sets none, view or edit.
- Edit applies only to the HOD and the members the HOD has given edit access.
- Default for every team: view on Schedule, Call sheets, and Cast and crew. None on everything else.
- Sections the owner controls: Script, Shot list and storyboard, Cast and crew, Props, Equipment, Breakdown, Schedule, Call sheets.
- Other sections are fixed: Overview and Scenes are visible to everyone on the project. Team and access is for the owner and admins only. Export follows what each person is allowed to see.

### Script access

- Script access is a separate setting per person, set by the owner: none, selected scenes (one or more), or the entire script.
- Everyone sees the number and heading of every scene, so the schedule and breakdown make sense. Action and dialogue show only for scenes shared with that person.
- A new scene added later, such as 42A, is not shared automatically with people who hold selected scenes. The owner adds it. People who hold the entire script get it at once.
- The owner can select every scene a team is tagged on in the breakdown in one step.

### Row ownership

Some sections are shared by several teams, such as Props and equipment. Every row therefore belongs to one team.

- The team that creates a row owns it.
- Only that team's HOD and members with edit access can edit it. Everyone else who can see the section sees the row read-only.
- The owner or an admin can move a row to another team.
- Example: Camera adds an Alexa Mini and Lighting adds an Aputure 600d. The Camera HOD can edit the Alexa and can only look at the Aputure.
- Only the owner and the HOD can grant a person edit access.
- A person can be on two teams in the same project, for example a DOP who is also a director.
- The HOD manages the team and edits its sections.

## 7. Accounts, sign-in and joining

- Sign-in: email and password, Sign in with Google, and Sign in with Apple. Two-step verification is optional for everyone. Password rules and a reset flow are required. There are no magic links.
- Joining a project, two ways. An email invite is tied to one address and cannot be passed on: the person signs in or creates an account with that email and lands in the team the inviter chose. A join code belongs to one team in one project, expires, and can be revoked by the owner or the HOD. A person who enters it does not join at once: they are asked which team they belong to (the code's team is pre-selected, and they may add the job they do) and send a request. The HOD of the team they chose approves or declines it, or the owner or an admin when that team has no HOD (the owner and admins can always decide). Until then the person is not a member and sees nothing of the project. Once approved they are a read-only Member of that team, and only the owner or the HOD can grant them edit access. Email invites do not need approval because the inviter already chose the team.
- Code errors must be specific: expired, revoked, not found.
- A person who already has an account and uses the same verified email gets the same account, not a second one.
- Everyone who uses the app needs an account. Cast and day-players do not have to: they can be added as crew contacts with a full name and email, and receive call sheets by email as a PDF. If they join the app later with the same verified email, their row links to their account. There are still no public links or guest access.
- Before store release, check whether the App Store requires Sign in with Apple when Google sign-in is offered, and whether it requires in-app account deletion.

### Account deletion

- An owner who deletes their account must first transfer each project to another member or delete it. The account cannot close while it owns a live project. The screen lists those projects and explains.
- A crew member who deletes their account: their rows stay, shown as "Former member", with name and email removed. The HOD can later reassign those rows to a new person.

## 8. Script

### Getting a script in

A script gets into a project in one of two ways. Both end in the same place: a structured script made of scenes and typed elements (scene heading, action, character, dialogue, parenthetical, transition), editable in the app. Everything else in the product reads from the scene records, so it makes no difference how the script arrived.

- Write in the app. A text box that accepts Fountain, with highlighting for scene headings, action, character names and dialogue. Industry-style screenplay formatting in the script view. Each scene heading creates a scene record.
- Bring a script in. Formats: plain text, Fountain, FDX (Final Draft), PDF, Word (.docx). FDX is the most reliable format and the one Final Draft users already have.

### Import rules

- Every import ends on a review screen. Nothing is saved before the owner confirms.
- The review screen lists the detected scenes. The owner can fix a heading, merge scenes, split scenes, and confirm.
- Low-confidence detections are flagged, especially from PDF and Word.
- The file contents must not be uploaded anywhere before the owner confirms.
- Plain text, Fountain and FDX are reliable because they carry structure. PDF and Word are guesswork and need the review.
- A scanned PDF with no text layer cannot be read. Reading from an image is out of scope.
- A production script that arrives with its own scene numbers (including 42A and OMITTED markers) keeps them and arrives locked. v1 strips leading scene numbers, so this is a change.

### Who can edit the script

Only the owner and chosen writers can edit. Everyone else reads. Decided: editing is locked per scene at first. When one writer is in a scene, others see "being edited by X" and cannot change it until the writer is done. True live co-editing with cursors is a later possibility, not part of the first build.

### Editor requirements

- Fixed-width font, correct margins and element indents.
- A clear unlocked or locked state.
- Automatic element detection and tab or enter shortcuts between elements.
- A page count.
- Comments on the script for the director, producer and other readers.
- Several writers editing at the same time.
- Revision colours and marked pages after a lock.
- Export to Fountain and FDX as well as PDF.

### Built so far (first script step)

- Each scene's action and dialogue is one row of typed elements (`scene_text`), so the existing per-scene reading rule protects exactly that scene's words. Number, heading and status stay on the scene record.
- Writing is Fountain in a text box beside a live screenplay preview. Elements are detected from the text (character cue, parenthetical, dialogue, transition, action). A forced element starts with `!`, `@` or `>`.
- A scene is edited by one person at a time. The lock lasts two minutes and is renewed while the editor is open. Saving needs the lock, and a scene saved by someone else in the meantime is refused, so nobody overwrites another writer. Others see "Being edited by" the holder.
- Editing needs script edit access and the scene shared with the writer. A new scene is written after any scene (it gets a letter, such as 3A) or at the end (the next number when unlocked, a letter when locked).
- Scene numbers: none until the owner locks the script (see section 9). While unlocked, adding, moving or deleting scenes has no numbering effect, and lists show a dashed draft position instead of a number. A scene written after another goes after it in the script order.
- A locked script still allows text edits. Numbers stay frozen, and the edits are tracked as revisions per scene (section 9).
- Export to Fountain is available for the scenes a person can read.
- Import (owner only) reads Final Draft (.fdx), Fountain and plain text files, or pasted text, on the device. PDF and Word are not read yet. A review screen lists the scenes found with flags (no heading, no text, odd heading, a number used twice). The owner can fix a heading, merge a scene into the one before it, split a scene at any line, leave a scene out, and then confirm. Nothing is saved before the confirm, and the whole import is one step in the database (all scenes arrive or none).
- A file with scene numbers can arrive locked with its numbers kept (42A, omitted scenes), or as an unnumbered draft with the numbers dropped. A file without numbers arrives as an unnumbered draft. Importing into a project that already has scenes adds the new scenes after the existing ones. A locked script cannot be imported into: a new draft of a locked script needs the matching step, which is built next.
- Matching a new draft (built): when the project already has scenes, the owner reads the new file and then sees a matching screen. Scenes are matched by number first, then by heading (repeated headings pair in order), then by how alike their lines are, which is flagged "Check this match". Each match shows Unchanged, Text changed, Heading changed or New scene, with a line-by-line view of what was added and taken out. The owner can change any match from a list. Old scenes that nothing matched are marked omitted after the lock (keeping their numbers) or removed before it, or kept as they are. A scene someone is editing blocks the draft. The whole draft applies in one step, scene ids and numbers never change, new scenes are numbered from their place, and changed scenes are tagged with the revision with the changed lines marked.
- Export (built): an Export button on the Script page offers a PDF in standard screenplay layout, a Final Draft file (.fdx) and a Fountain file. All three are made on the device from the scenes the person can read. The PDF is US Letter in Courier 12 point (10 characters to the inch, 54 lines a page, left margin 1.5 in, right 1 in), with the scene heading in bold, scene numbers in both margins, character, parenthetical and dialogue indented, transitions at the right, the page number top right from page 2, a header line with the project name and the revision (or DRAFT), and an asterisk in the right margin on every line changed after the lock. A scene heading never ends a page. Omitted scenes print as OMITTED with their number. There is no title page. The FDX keeps scene numbers and omitted markers so it opens in Final Draft and imports back into LineBoard unchanged.
- Still to do: PDF import and Word import.

### Script export

The script exports as a PDF in standard screenplay layout with scene numbers, and as a Final Draft file and a Fountain file (see the built list above).

- There is no separate Scenes section. The Script page has a scene list on its left: open it shows each scene's number and heading, collapsed only the number (the choice is remembered). Pressing a scene scrolls the script to it, and the scene in view is highlighted. A person who may change scenes swipes a row left: Delete before the lock (with a confirmation), Omit or Restore after it. Lock script and Unlock script are on the Script page. On a phone the list opens from a Scenes button. Each scene in the script has an Edit button (tapping the text does not open the editor, so scrolling with a finger cannot open it), and the editor lets the number be fixed by hand while the script is unlocked. The old Scenes address opens the Script page.

## 9. Scenes and script revisions

### The scene is the permanent record

A scene has its own ID, a display number (1, 42A; empty until the script is locked), a heading and a status (active or omitted). Shots, breakdown, cast, schedule and call sheets attach to the scene ID. Props and equipment lists attach to the schedule.

### Locked and unlocked scripts

This follows Final Draft's workflow, with one change: Final Draft locks pages, LineBoard locks scene numbers. LineBoard has no paper pages (page count is only an estimate), so there are no page numbers or A-pages.

| State | Scene numbers | What happens |
|---|---|---|
| Unlocked (drafting) | None. A scene shows a dashed draft position (1, 2, 3 ...) that is not a number and changes freely | Scenes can be added, moved and deleted with no numbering effect. A new draft replaces the current one |
| Locked (production) | Given at the lock, then frozen | A scene written between two others takes a letter (2A, 2B, and 2AA between 2A and 2B). A scene added at the end takes the next whole number. A scene added before the first takes A1. A cut scene stays in the list marked OMITTED. No existing number changes |

- The owner presses an explicit Lock script button. The screen explains: every scene is numbered 1, 2, 3 in script order, and the numbers freeze. Locking is one step in the database, and it starts revision 1 (Blue).
- Unlocking keeps every number. Scenes added or removed while unlocked stay unnumbered (or are removed), and the next lock numbers only those, with the same letter rules. The owner can fix a number by hand while unlocked. Numbers never change silently.
- The app suggests locking at the first moment others start to depend on the numbers: the first crew invitation, the first breakdown entry or the first schedule entry. The app suggests, the owner decides. A call sheet should need a locked script.
- A script that arrives with its own scene numbers (a production script with 42A and OMITTED markers) keeps them and arrives locked.
- A new draft goes through a matching screen: old scenes on one side, new scenes on the other, matches, inserted scenes (42A), omitted scenes, and an owner approval step.
- Nothing downstream changes automatically when a draft arrives or a scene is revised. Scenes whose text changed are flagged for review.

### Revisions per scene

Final Draft marks revisions on pages with colours and margin asterisks. LineBoard marks them on scenes.

- Revision rounds use Final Draft's colour order: White (the locked original), then Blue, Pink, Yellow, Green, Goldenrod, Buff, Salmon, Cherry, and the cycle repeats. Locking starts revision 1 (Blue).
- After the lock, saving a changed scene marks the scene as revised in the current revision, and marks each changed or new line with a coloured bar and an asterisk in the margin. Lines that did not change keep their earlier mark. A new scene written after the lock is marked in the current revision.
- The owner or an admin starts the next revision (Blue becomes Pink) when a round of changes has been issued. Marks from earlier rounds stay.
- Nothing is marked before the lock. Revision marks are recorded by the database, never sent by the browser.
- Why this matters on a shoot: when a scene is added or changed during production, the AD adds it to the schedule and reissues the call sheet with the new sides. The scene's revision tag tells everyone which round the pages belong to.

### Scene screens

- A list of scenes: display number, heading, status (active or omitted), shot count, a lock icon.
- A scene detail screen: heading, script excerpt for people with script access, linked shots, breakdown, schedule day.
- A person with selected-scene access sees the text of their scenes, and only the number and heading of the others, with a message that explains it.
- Omitted scenes collapse to one dashed row with a Show button.

### Decided

- The owner can unlock a locked script, with a warning that scene numbers may change again.
- New drafts match scenes by number first, then by heading text when the draft has no numbers. The owner approves the result.
- A revised scene keeps its shots. The scene is flagged for review.
- Line marking (v1's way of making shots) is an optional shortcut, built later. Shots are created in the shot list.

## 10. Shots

### Shot list

- Shots are grouped by scene. Numbers read scene-shot (42-1, 42-2) and count within a scene.
- Rows are created, edited, duplicated and reordered by drag within a scene.
- Each row shows: shot number, description, size and movement, lens, owning team, status.
- Rows another team owns are read-only, show a lock, and name the owning team.
- A stale-link badge sits under the description when the linked script passage changed in a revision. The row never moves because of it.
- Conflicts: when two people edit the same row, the second save is held and a dialog shows both versions field by field with "keep mine", "keep theirs" or "merge". Unchanged fields are listed as "Same in both".

### Shot detail

Every detail entered on a shot appears in one detail view, so the call sheet and the shot list never disagree:

- Status (planned, done, dropped). Only AD-team members with edit access (the 1st and 2nd AD) can change it.
- Storyboard frame.
- Shot size, shot type, lens, movement.
- Cast and crew needed.
- VFX required, sound effects required, special effects.
- Action.
- Silent shot flag.
- Notes.
- The linked script passage, for viewers who have script access.
- Who owns the shot, and who last edited it and when.
- Previous and next shot navigation.

The shot's owning team edits the shot. The VFX team and the Sound team can add their own notes in their own fields (VFX required, sound effects required) on a shot they do not own. Each such field shows which team can edit it.

### Built so far (first shot list step)

- The Shot list page groups shots by scene. A shot reads scene-shot (42-1, 42-2) from the scene's number and the shot's place, so it is never stored and renumbers by itself. Before the lock a scene has no number, so its shots read with the scene's draft position.
- Each row shows the shot number, description, size and movement, lens, owning team (with a pencil if your team edits it, a lock if not) and status as a shape and a word. Dropped shots are struck through. The page shows done, dropped and planned counts with a small bar. A scene revised after the lock shows "Scene revised, check these shots". Omitted scenes collapse to one dashed row with a Show button.
- The detail view (opens from a row) holds: description, shot size, shot type, lens, movement, action, cast needed, crew needed, VFX required, sound effects required, special effects, silent flag, notes, owning team, status, and who added and last edited it. Size, type and movement suggest common values but accept anything. Previous and next shot buttons move within the scene. Duplicate and delete (asked twice) are for the owning team.
- Order inside a scene is changed with up and down buttons (drag is not built).
- Who may change what is enforced in the database. The owning team's editors change everything except status. The VFX team and the Sound team can fill in their own field on a shot they do not own. Only AD-team members with an edit grant, and the owner and admins, change status. Everyone with view access to Shots reads every shot. A new shot cannot start as done unless you may set status.
- Two people editing the same shot: the second save is refused with "Someone saved this shot while you were editing it" and a button to load their version. The field-by-field merge dialog from the brief is not built.
- Not built yet: the script passage link with its stale badge, the storyboard frame, linking cast and crew to the real cast list (the two fields are text for now), and the shot status daily list on the call sheet.

### Shot status

- Planned, done or dropped, shown with a shape and a word, never colour alone.
- Only AD-team members with edit access (the 1st and 2nd AD) can change it. Everyone else sees the controls greyed out with the reason and who to ask.
- Dropped shots read struck through and muted. The daily list shows a count of done, dropped and planned shots.

## 11. Storyboard

- A grid of frames per scene and per shot.
- Image upload with compression. Each frame can hold up to 4 photo layers plus pen drawing, flattened when the frame is marked done and on export (carried over from v1).
- A size meter against a per-project image cap. The cap value is not set.
- Offline, frames are blank. Show an empty state and a prompt to export the storyboard as a PDF before going to a location with no signal.
- Upload failure and oversized image states are required.

### Built so far (first storyboard step)

- One frame for each shot, shown in a grid under its scene. Each card shows the picture (the flattened image when done, otherwise the layers and drawing painted on the spot), the shot number, the shot description and a word for the state (Done, Sketch, Add a frame). A frame belongs to the shot's team: the owning team's editors change it, everyone with view access to Shots sees it.
- The frame editor holds up to 4 photo layers, each with a Show tick, a See-through slider and move up, move down and Remove, and a pen with three colours and three widths, Undo and Clear drawing. It works with a finger, a pen or the mouse.
- Photos are compressed in the browser before upload: at most 1280 pixels on the long side, JPEG, about 450 KB or less, from a camera roll file of up to 25 MB. A file that is not a picture, one that is too big, and an upload that fails each show a plain message. Pictures live in a private storage bucket and are shown through links that expire after an hour.
- Mark done flattens the layers and drawing into one picture and deletes the layer files, which frees the space. Reopen to edit turns the flattened picture back into layer 1.
- A per-project size cap: 200 MB by default (a working value, the brief left it open), changeable by the owner and admins, shown as a meter. The database refuses a frame that would take the project past the cap. Deleting a project, a scene or a shot also deletes its pictures.
- Offline the grid shows blank frames with a banner telling people to export the storyboard as a PDF before they lose signal. Export storyboard PDF makes a landscape Letter PDF, six frames to a page, each with its shot number, size and description.
- Not built: pen pressure, an eraser, rotating or moving a photo layer, images in the call sheet, and clearing pictures left behind when a draft removes scenes (apply draft).

## 12. Cast and crew

- One list per project. Names, roles and call times are visible to everyone with view access.
- Phone and email are visible only to the owner, admin and the AD team. Everyone else sees a lock where the contact would be, and the contact fields stay out of any view they have no access to.
- Each row belongs to a team that manages it. The screen shows this as a small "Managed by" line, not as a main field. Cast rows have no department; crew rows have a role (the job) and a department (the group, extensible).
- Cast is detected automatically from dialogue cues. Automatic cast rows are locked, manual rows are deletable.
- 10 default crew departments, with departments and roles editable.
- Every new member (approved join request or accepted email invite) is added to this list automatically as a crew row for their team, with their name, linked account, the job they gave, and their account email as the contact. A row that already matches by email is linked, not duplicated. The owner is not added.
- A deleted member's rows show "Former member", and the HOD can reassign them.

## 13. Breakdown

- One form per scene: location, date, synopsis, cast, crew, extras, props, equipment, wardrobe, hair and make-up, sound and special effects.
- Each element has an owning team.
- Automatic defaults become explicit once edited. Crew can be included per whole department.
- A quantity above 0 is the gate for an equipment item to count in the breakdown, and props are tagged to scenes (carried over from v1).
- Built so far: the scene form and the nine element lists, owning team per element, names chosen from a dropdown that grows with the project, cast offered from the script's dialogue cues (only to people who may read that scene), crew by whole department, equipment at 0 listed but not counted, a team filter, and a one-step pick of every scene a team is tagged on when sharing script text. Not built: the breakdown PDF, a button for the owner to move an element to another team.

## 14. Props and equipment

- Decided: Props and Equipment are two separate sections, each with its own sidebar entry, its own screen and its own access setting per team, because they belong to different departments (Art and Props for props, Camera, Lighting and Sound for equipment). Everything below applies to each of them.
- One prop list and one equipment list per schedule. A film with one schedule has one of each. A 4-day schedule and a 12-day schedule each get their own. They do not follow scenes, days or the breakdown sheet.
- Each team types its own items. A suggest button may propose items from the breakdown of the scenes in that schedule. The team accepts or ignores them.
- Item fields: name, quantity (default to a sensible quantity of at least 1, never 0), owning team, notes, status, supplier, linked scenes where relevant.
- A copy button brings items across from another schedule. After the copy, each list is edited on its own.
- A team edits only the items it owns. Other teams with view access to the section see those items read-only. Production, the owner and admin see every item.
- Each team sees the relevant columns. Cost fields, such as rental price, are visible only to Production, the owner and admin, and live in a separate restricted record, so a department sees an item without its cost.
- Each schedule's lists have their own screen and their own PDF. The PDF goes only to the relevant teams. The lists do not appear on call sheets.
- Built: Props and Equipment are two screens over one table (`schedule_items`, kind prop or equipment) with a schedule picker, an extensible category and supplier list, status (Needed, Confirmed, Ready, Returned), linked scenes picked from the scenes placed in that schedule, suggestions from the breakdown for those scenes (add one, add all, ignore), copy from another schedule (only items the person can edit for), a separate cost record readable only by the owner, admins and the Production team, and a small "Managed by" line instead of an owning-team field. Not built: the per-schedule PDFs.
- Open: whether status, supplier and cost stay after the first feature set, since they start a budget feature. Equipment has 9 categories in v1 and props are free-form.

## 15. Schedule

- A list of schedules. Each schedule is a block of shoot days with a name, start date and end date.
- Creating a schedule makes a shoot day for every date from the first to the last day (with an option to leave out Saturdays and Sundays), so nobody adds days one by one. Days that will not be shot are deleted. Editing the dates adds days for new dates and removes empty days that fall outside, and refuses if scenes are placed on a day that would go.
- Different shots of the same scene can be shot on different days. A scene is placed on a day as before; opening the scene's shots lets each shot be sent to another day. A shot follows its scene unless it has a day of its own. A scene then shows on every day that has some of its shots, marked "2 of 3 shots", and the call sheet, the schedule PDF and the props and equipment scene lists follow the same rule.
- Each shoot day has a date, a location and the scenes shot that day, assigned by scene ID.
- A clear view of unscheduled scenes.
- A stripboard: one strip per scene showing number, heading, interior or exterior, day or night, cast and page length, ordered by shoot day, with strips moved between days by dragging.
- Cast availability rules: a cast member can be marked unavailable on dates, and the schedule warns when a scene with that cast is placed on such a day.
- Open: which team owns the schedule and the call sheet, the first AD team or the owner. The working assumption is the AD team, under the row ownership rule.

## 16. Call sheets

### Building a call sheet

- Auto-filled from the shoot day: date and shoot day number, location, general crew call, scenes of the day, cast with call and makeup times, crew by team with call times, notes, nearest hospital, and optionally the weather forecast for the day.
- The AD team's edit holders edit and publish it. Before sending, an authorised person (those holders, the owner or an admin) can add or remove email addresses on the recipient list. Recipients without an account receive the call sheet as a PDF attached to the email, not as a link.
- After publishing, any change creates a numbered revision. Changed lines are marked, and the sheet shows the revision number, who sent it and when.
- Delivered in the app to people with accounts, and as a PDF that looks like a professional call sheet and prints cleanly on A4. It can be printed or emailed, and it always stays in the app.

### On the shoot day

- Anyone listed on that day's call sheet automatically gets that day's sheet and its shot-by-shot details. No manual access change is needed. Script access stays as the owner set it.
- Only AD-team members with edit access (the 1st and 2nd AD) can change a shot's status.
- Status changes appear on crew screens within seconds while they are online.
- With no signal, crew see the last loaded state, marked with when it was updated.
- An AD who loses signal keeps the change on the device, and it is sent when the connection returns.

Built so far: one call sheet per shoot day (start, edit the general call, nearest hospital and notes, publish). A published sheet is a numbered revision (a snapshot of the day, scenes, cast with call and make-up times, crew by department with call times, notes); publishing again makes the next revision, and changed lines are marked with the word Changed and a bar, and removed lines are listed. Viewers read only the published version, editors see a working copy with the count of unpublished changes. A4 PDF with changed lines starred. The shots of the day (read live) are shown with status counts. Not built: the recipient list and sending by email, weather, shot status changes by the AD team, on-the-day automatic access to shot details, offline caching.

On the shoot day, the shots of the day on the call sheet carry a status control for the AD team's edit holders, the owner and admins: Planned, Done, Dropped. Everyone else sees the status as text. The call sheet refreshes the shots every few seconds while it is open, so a change reaches crew screens within seconds while they are online (tested: about 3 seconds).

### Shot list on the call sheet

The shots of the day show as a short list grouped by scene. Each row shows the shot number, shot size, a short description and the status, for example "42-3, medium close-up, Anna opens the door, planned". Rows also carry flags for VFX, SFX and SILENT where they apply. Tapping a row opens the shot detail (section 10).

### Lists, rows and deleting

- Wherever a list row has a detail, the whole row opens it, not only the title. Buttons and fields inside the row keep their own job, and selecting text does not open the row.
- A row the person may delete can be swiped left (touch or pen, or a sideways two-finger scroll on a trackpad). A red Delete button with a trash icon and the word Delete appears. Pressing it asks first (Keep it or Delete), then deletes. A tap elsewhere closes it. The same Delete button stays in the detail for keyboard and screen reader use. Built for cast and crew, props and equipment, shots and scenes.
- Where rows can be put in order (shots within a scene, scenes on shoot days), the whole row can be dragged, not only a handle. With a mouse the drag starts after a few pixels of movement, so a click still opens the row. With touch or a pen the person presses and holds for a moment, then drags, so scrolling and swiping still work. The up and down buttons stay for keyboard and screen reader use.

### Reference layouts

Two layout previews were produced for this feature and give the intended screen structure. They use a fictional film called The Last Ferry and are previews, not final art.

**Screen A: the call sheet with the shot list (tablet landscape)**

- Top bar with the logo, project name, section path and a permission pill (for example "Viewing as Camera team").
- Section list on the left with Call sheets selected and sections without access shown with a lock.
- Title "Call sheet, shoot day 3 of 12", with date and schedule name under it, and a Revised badge showing the revision number, with "changed lines marked, sent 18:40 by Lena Hofer, 1st AD".
- A row of four cards: general crew call as a large number (07:00), location, scenes of the day as scene chips, nearest hospital.
- The shots card: a progress line ("2 done, 1 dropped, 6 planned") with a small bar, a table head (shot, size, description, flags, status), a scene header row per scene (scene chip, heading, shot count), then one 52px row per shot with a chevron. The tapped row is highlighted. A note under the table says only the AD team can change a status and everyone else can open and read any shot.
- A side card: cast calls (name, call time, makeup time), crew by team with call times, and contact details shown as "AD team only" with a lock.

**Screen B: the shot detail after tapping a shot (tablet landscape)**

- A back button to the shots of the day, then the scene-shot chip (42-3) large beside the shot title, with scene heading, owning team, and last editor and time. Previous and next buttons on the right.
- A status card: Planned, Done and Dropped as a segmented control, with Done and Dropped greyed out for non-AD viewers, and a locked pill ("Status locked, only the AD team's editors can change it") with who to ask.
- Left column: storyboard frame (with caption), script passage in the script face (only if the viewer has script access), notes.
- Right column: a card of shot size, lens, movement and sound; action; who is needed (cast and crew as tags); department requirements (VFX required, sound effects required, special effects), each with a pill naming the team that can edit it.

## 17. Connectivity and offline

- Editing needs a connection.
- Offline, the app is a read-only cache of text: scenes, shots, call sheets and lists for projects the user has opened. No images. A quiet, persistent offline banner says so.
- The cache is rebuilt from the server on every launch. iOS can clear cached web app data after 7 days of inactivity and can cap storage at roughly 50 MB, so the cache must always be rebuildable and must survive these limits.
- Connection drops mid-edit: the typed draft is kept on the device and sent when the connection returns. Show "Not saved yet. Sends when you're back online." next to the field. This protects a short outage. It is not offline editing.
- Two editors change one row: the second save is held and the conflict dialog appears (section 10).
- Live status updates appear on other crew screens within seconds while online.

## 18. Email

Email is how crew are alerted, because push does not work for home-screen web apps in the EU.

- Call sheet change alerts: sent when a published call sheet gets a new revision.
- Retention reminders (section 21).
- Use a free email service. Free tier limits are 3,000 emails a month and 100 a day, so the choice must be revisited if the daily cap binds.
- Sender display: "Owner Name via LineBoard". Replies go to the owner. Delivery comes from LineBoard's own address, because mail sent as someone else's address fails sender checks.
- The email service must be named in the privacy policy.
- Open: whether crew email addresses must stay inside the EU. The service currently considered stores account data in the United States.

## 19. Exports

- Five PDFs carried over from v1, kept separate because different departments get different files: shots and storyboard, breakdown, cast and crew, props, equipment.
- Props and equipment PDFs are one per schedule.
- The script as a PDF in standard screenplay layout with scene numbers.
- The call sheet as a PDF on A4.
- A full project backup file for the owner and admin. The zip file from v1 becomes an export option, not the storage.
- Built: a PDF for the shot list, breakdown, cast and crew (phone and email only for those who may see contacts), props and equipment (one per schedule, cost only for those who may see it), schedule, and the call sheet. Each is on its own page, and every PDF is A4 with no size choice. Export and settings lists them with links. The storyboard PDF and the script PDF were built earlier.
- The owner and admin export everything. Everyone else exports only what they can see.
- The owner can always export before deleting a project.
- Owners export a backup file. Confirm what backups the hosting plan includes, since the app keeps no copy of its own.

## 20. Privacy, security and law

- The hosting region is not fixed yet (section 23). State it in the privacy policy, and sign the hosting provider's data processing agreement before real crew data goes in. Do the same check for the email service and any payment service.
- A privacy policy that names each service holding data, plus an Impressum.
- In-app account deletion and a full project export, which together cover erasure and data portability.
- Phone and email stay hidden from anyone without access.
- No tracking cookies and no usage tracking beyond server logs. Confirm in the privacy policy review whether this removes the need for a consent banner.
- Open: who counts as the data controller for the crew details an owner enters, the owner or LineBoard. This is a legal question for a lawyer.
- This document is not legal advice.
- Row-level, team-level and scene-level rules must hold even for requests that bypass the app. Test that a member cannot read or edit anything outside what they were given.

## 21. Parked: pricing, limits and lifecycle

Parked until the base and the first features work. Nothing here is built now, but nothing is deleted. The build has no caps, no limits and no paywalls in the meantime. These decisions are revisited when the first public release is planned.

- Model: the owner pays per project and the crew never pay. A free tier and a one-time project pass (12 months, unlimited editors, images included). Price to be set.
- Free tier idea: 1 project per account, up to 5 editors including the owner, unlimited members, 15 scenes counting every scene ever created (omitted ones included), text only with no storyboards.
- Rules if caps return: the server enforces every cap, pending invitations count toward the editor cap, code joiners are members and become editors only if a slot is free, the free project limit is per account.
- Lifecycle: a project is active for 12 months, read-only for 12 more, then deleted. The owner gets a monthly reminder email, and a weekly one in the final month. A full export is always available before deletion. In-app banners show the same reminders.
- Payment: web checkout through a merchant of record that handles EU VAT. Stripe is the cheaper alternative but leaves VAT to the owner. Confirm current fees and check the owner's VAT position with a Steuerberater.
- Image storage and delivery must stay affordable as usage grows, so the app must be able to move images to cheaper storage. This and the studio-hosted version are built, not parked (section 4).

## 22. Screens and states to design and build

### Navigation

Inside a project, a persistent navigation: Overview, Script, Shot list, Storyboard, Breakdown, Cast and crew, Props, Equipment, Schedule, Call sheets, Team and access, Export and settings. Each section shows only what the viewer may see. Sections without access stay in the list with a lock. They are never hidden or broken. On desktop and landscape tablet the list is a full-height gray column that can collapse to an icon rail. On portrait tablet it starts as the icon rail. The open and close toggle works everywhere the list is at the side. Only on a phone (under 640px wide) does it move to the bottom, as a fixed grid of icons with no scrolling.

### Account screens

- Sign up and sign in with email and password.
- Join with a code: a short field with clear success and error states ("code expired", "code revoked").
- Projects list: a card per project showing name, the viewer's role, and status. A button to create a project.
- Account settings: profile, password, delete account (blocked while the user owns a live project, with the list of those projects).

### Project screens

- Overview: scene count and locked state, next shoot day, latest call sheet status, who is on the project, alerts tile (script unlocked, stale links).
- Script: editor, lock state and lock action, import, import review, new-draft matching, PDF export.
- Shot list, Shot detail, Storyboard, Breakdown, Cast and crew, Props, Equipment, Schedule, Call sheets (screen A and B above).
- Team and access: teams list and team detail (members, roles, which sections the team can view or edit), a permission matrix of teams by sections (none, view, edit), script sharing per person with a scene picker, join codes (generate for a team, set an expiry, revoke).
- Export and settings: per-section PDF export, full backup for owner and admin, delete project with a confirmation that asks the owner to export first.

### System states every feature must include

- Offline banner and read-only cache.
- Held draft ("Not saved yet").
- Edit conflict dialog.
- Permission denied or locked, with the reason and who can change it.
- Empty states for every section, with the next step.
- Loading and error states, including a failed upload and an oversized image.
- Import failures and low-confidence detections.
- Stale script link.
- Script locked or unlocked.
- Read-only project and final month before deletion (when lifecycle is built).

## 23. Open questions for the owner

Ask before building any of these.

Decided so far: feature order starts with script, then scenes, then shot list, breakdown, cast and crew, schedule, call sheets, exports, the rest (old question 1). Line marking is optional (3). The AD team owns schedule and call sheets (4). Unlock and matching rules (5) and shots kept on revision (6) are in section 9. Hosting is free tier in the EU (part of 11).

2. Which shot fields the first shot feature ships: a basic list (number, size, short description) first and the full detail view after, or everything at once.
7. The image size cap per project.
8. Which weather source to use for the optional call sheet weather, since the owner prefers free options.
9. Whether crew email addresses must stay in the EU.
10. Who is the data controller for crew details.
11. Which hosting region to use, and which backup coverage the hosting plan includes. Also whether the hosting plan has a spend cap.
12. Whether the realtime connection limits of the free hosting tier are enough for a crew of 30 on one project.
13. App store rules (Sign in with Apple, in-app account deletion, in-app payments), checked only when store apps come.
14. Whether status, supplier and cost on props and equipment items stay.


---

# Part 2: Design system

This is the LineBoard 2.0 design system, owned by the owner. Every screen follows it. The source of truth is the owner's Design System artifact (project/README.md, project/tokens.json, project/components). It is reproduced here in full so the brief is self-contained. If this document and the design system artifact differ, the design system artifact wins.

## 24. Design language

LineBoard takes a film from script to call sheet, shared with the crew. It is for filmmakers who can't pay for Final Draft, StudioBinder or Movie Magic. This system is the LineBoard 2.0 look: the black-and-white language of LineBoard v1, sized up for touch and given the states a shared, multi-team app needs.

Most people who open LineBoard only read. They check a call time on a phone in bright sun, or look up their scenes on a tablet in a dark room. Design for the reader first, then the few people who edit.

### Principles

- **Layers, not lines.** Three layers make the depth: `canvas` is the app background, cards and panels sit on it in `paper` with `shadow-1`, and dialogs float above with `shadow-3`. Inside a card, `surface-sunken` marks things pressed in (segment tracks, secondary buttons, read-only fields). Rows are split by faint `rule` hairlines. Lines appear only where they mean something: input borders, dashed status, red conflict.
- **Active means filled and raised.** The selected tab, the current nav item, the primary button and the scene header row are filled with `ink`, use `on-ink` text, and the pressable ones lift with `shadow-button`. Nothing is "selected" by colour alone.
- **Black and white stays.** The grey layers add depth without new colours. Ink, white, the one red and the stale amber are still the whole palette.
- **One red.** `red` is the stick of the logo mark, conflicts, deletion warnings and destructive buttons. It never marks selection and never decorates.
- **The scene is the anchor.** A scene number (42, 42A) always sits in a scene chip, and shots read as scene-shot (42-1). Numbers lock; the UI shows the lock.
- **Permission is always visible.** Every editable area says who can edit it. Every row says which team owns it. A lock always comes with a reason and who can change it.
- **Touch first.** Nothing tappable is under `touch-min` (44px). Rows are `row-height` (52px).

### Content fundamentals

- Plain words, short sentences, film terms where crews use them: call, crew call, HOD, 1st AC, wrap, omitted, insert.
- Sentence case for headings and buttons ("Publish Rev 3", "Keep mine"). Caps only for `label` text: table heads, box labels, badges.
- Buttons say what happens. Errors say what went wrong and what to do: "This code ran out on 9 March. Ask the person who sent it for a new one."
- Explain locks in one line: "42-3 belongs to Production. Their HOD or an editor on their team can edit it, or the owner can move it to Camera."
- No exclamation marks, no emoji.

### Colour

Light is the default. In dark, `canvas` goes black and cards step up to a lighter charcoal, so the lighter surface does the lifting that shadows do in light.

| Token | Use |
| --- | --- |
| `canvas` | Layer 0, the app background |
| `paper` | Layer 1, cards, panels, dialogs |
| `surface-sunken` | Pressed-in areas inside a card |
| `surface-soft` | Selected row, unsaved draft row, quiet notes |
| `ink` | Text, active fills, focus |
| `on-ink` | Text on ink fills |
| `ink-muted` | Secondary text, other teams' rows |
| `ink-subtle` | Labels, captions, locked items |
| `rule` | Faint row dividers only |
| `outline-quiet` | Input borders, dashed outlines: None, empty, omitted, locked |
| `red` | Conflict, destructive, the logo's stick |
| `stale` | Stale-link badge only |

### Status

Every status has a shape and a word first, colour second.

| Status | Treatment |
| --- | --- |
| Locked | Outline badge with a lock icon |
| Revised | Ink-filled badge starting with `*`, the way scripts mark revisions |
| Omitted | Dashed `outline-quiet` badge, struck through |
| Stale link | Dashed `stale` badge with a warning triangle |
| Conflict | 2px `red` badge or row outline |

### Depth

| Layer | Surface | Shadow | Holds |
| --- | --- | --- | --- |
| 0 | `canvas` | none | The screen |
| 1 | `paper` | `shadow-1` | Cards, tables, the section list, banners |
| Bar | `paper` | `shadow-bar` | The strip under the header, bottom action bars |
| 2 | `paper` | `shadow-3` | Dialogs and sheets over `overlay` |
| Pressed in | `surface-sunken` | `shadow-inset` on inputs | Tracks, secondary buttons, read-only fields |

Buttons behave like keys: they sit raised (`shadow-button` on primary, `shadow-control` on secondary) and drop 1px with no shadow while pressed.

### Type

System sans for the interface (SF Pro on Apple, Roboto on Android): 700 to 800 for labels and numbers, 400 for running text. Courier only in the script view and import preview. Use `number-lg` for call times and counts that must be read at arm's length.

### Layout

- **Landscape and desktop (1000px and wider):** top bar (logo, project and role, screen actions) in `paper` with `shadow-bar`. Under it, the section list is a full-height column in `side-gray` (see Tokens), flush with the left screen edge and running from the top bar to the bottom of the screen. Only its outer right edge is rounded, with `radius-lg`. Content cards sit on `canvas` to the right, with `space-5` padding inside the content area.
- **Collapsible section list:** a toggle button sits at the left of the section list's header row, beside the viewer's team and role. It has no background of its own, so it merges with the column, and shows a faint shade only on hover. Collapsed, the column narrows to a rail (64px) of one icon per section, with the toggle still at the top. The current section stays filled with `ink`, locked sections are dimmed, and every icon has a tooltip and an accessible name. The choice is remembered on the device, and Ctrl or Cmd + B toggles it. The toggle carries `aria-expanded`.
- **Portrait tablet and phone (under 1000px):** no side list and no Sections button or sheet. All sections sit in one strip along the bottom, in `surface-sunken` (light gray) with `shadow-bar`. The strip slides sideways, each section is a `paper` button with the current one filled with `ink`, and the current one is scrolled into view. The strip fades at the edges to show there is more. Safe-area padding is added at the bottom.
- Sections without access stay in the list with a lock. They are never hidden.

### Iconography

Inline stroke icons at 2.2 to 2.6px stroke, 12 to 16px (section icons in the section list are 22px), `currentColor`: lock, pencil (you can edit), eye (view only), warning triangle (stale), cross (conflict), cloud with a slash (offline), plus one icon per section for the collapsed section list. No icon fonts, no filled icons, no emoji. An icon never stands alone without a word or an accessible label.

### Logo

LineBoard has a logo, supplied in `docs/lineboard-brand/` (read `LOGO.md` there before placing, resizing or recolouring it). It is an open clapper slate reduced to two shapes: an `ink` board and a `red` stick lifted 13 degrees, with the word LineBoard to the right. The word is outlined in the SVG, with no full stop. Use the supplied files only. Never redraw the logo, retype the word in a font, generate a new icon, put the logo in a box, add shadows, gradients or clapper stripes, or use any red other than the `red` token. Light and dark versions are swapped with `<picture>`, not recoloured. Minimum size is 16px tall for the mark and 20px tall for the full logo.

### Accessibility

Body and label text meet 4.5:1 on `paper`, `canvas` and `surface-sunken` in both themes. Input borders and dashed outlines meet 3:1. Depth never replaces a label: a raised button still says what it does. Focus shows a 3px `ink` outline offset by 2px. Status never relies on colour alone.


## 25. Tokens

### Colour tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#f3f3f3` | `#000000` | Layer 0: the app background behind every card, list and panel. |
| `paper` | `#ffffff` | `#1c1c1e` | Layer 1: cards, panels, the section list, dialogs, the bar under the header. Always sits on canvas with shadow-1 (light) or by its lighter tone (dark). |
| `surface-sunken` | `#ebebeb` | `#2c2c2e` | Pressed-in areas on a card: segmented control tracks, secondary buttons, read-only fields, inactive choices. |
| `surface-soft` | `#f2f2f2` | `#242426` | Selected or unsaved table row, quiet notes, owner/admin summary rows inside a card. |
| `ink` | `#000000` | `#ffffff` | Body text, active tab and nav fill, scene header rows, primary button fill, focus rings. |
| `on-ink` | `#ffffff` | `#000000` | Text and icons sitting on an ink fill: primary buttons, active tabs, scene header rows, the scene chip. |
| `ink-muted` | `#4d4d4d` | `#c2c2c2` | Secondary text: rows another team owns, descriptions under a heading, helper paragraphs. 8.5:1 on paper in light, 11:1 in dark. |
| `ink-subtle` | `#666666` | `#a3a3a3` | Caps labels, captions, locked nav items, timestamps. At least 4.7:1 on paper, canvas and surface-sunken in both themes. Do not go lighter: v1's #777 failed 4.5:1. |
| `rule` | `#ebebeb` | `#2c2c2e` | Faint 1px dividers between rows inside a card. The only plain line in the system. |
| `outline-quiet` | `#8a8a8a` | `#707070` | Input borders and dashed outlines for None cells, empty states, omitted scenes and locked indicators. Passes 3:1 as a control border in both themes. |
| `red` | `#c81e1e` | `#ff5c5c` | The one accent. The logo's stick, conflicts, destructive actions, deletion warnings. Never selection, never decoration. 5.9:1 on paper in light, 6.4:1 in dark. |
| `stale` | `#7a4a00` | `#f0b14a` | Stale-link badge text and its dashed border. The only extra hue; always paired with a warning icon and the word STALE. |
| `overlay` | `rgba(0,0,0,0.45)` | `rgba(0,0,0,0.7)` | Scrim behind dialogs. |
| `side-gray` | `ink` 11% over `canvas` | `ink` 11% over `canvas` | The section list column, open or collapsed. Calculated (`color-mix(in srgb, var(--ink) 11%, var(--canvas))`) so it is a clearly darker gray than `canvas` in light and the matching shade in dark. Not a new hue. |

### Type

Families: sans = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif`; script = `"Courier New", Courier, monospace`.

| Style | Size | Line height | Weight | Letter spacing | Use |
| --- | --- | --- | --- | --- | --- |
| `wordmark` | 20px | 1.1 | 800 | 0.02em | Reference only: the logo's wordmark is outlined in the logo SVG, never typed. |
| `number-lg` | 44px | 1 | 800 | -0.02em | Call times and big counts read at arm's length: crew call, your call, scene count. |
| `title` | 28px | 1.15 | 800 | normal | One per screen, top left of the content area. |
| `heading` | 20px | 1.2 | 800 | normal | Dialog and section headings. |
| `body` | 15px | 1.45 | 400 | normal | Shot descriptions, table cells, paragraphs. |
| `body-strong` | 15px | 1.45 | 700 | normal | Shot numbers, names, nav items, buttons at 14px. |
| `caption` | 13px | 1.45 | 400 | normal | Helper text under fields and boxes, explanations of why something is locked. |
| `label` | 11px | 1.2 | 800 | 0.08em | Caps labels above boxes, table heads, badge text. Always uppercase. |
| `script` | 14px | 1.55 | 400 | normal | The script view, import preview and scene headings quoted from the script. Nowhere else. |

### Spacing

| Token | Value | Use |
| --- | --- | --- |
| `space-1` | 4px | Icon to text inside a badge. |
| `space-2` | 8px | Gap between buttons in a row, between a label and its box. |
| `space-3` | 12px | Cell gap in table grids, row padding inside boxes. |
| `space-4` | 16px | Gap between boxes, minimum side gutter on phone. |
| `space-5` | 20px | Screen padding on tablet, gap between sidebar and content. |
| `space-8` | 32px | Outer padding on account screens (projects, sign in). |

### Radius

| Token | Value | Use |
| --- | --- | --- |
| `radius-sm` | 2px | Scene chips, badges, script page. |
| `radius-md` | 4px | Buttons, segmented controls, inputs, banners, permission pills. |
| `radius-lg` | 6px | Cards, the outer edge of the section list, dialogs. |

Corners are deliberately small (the first 12px version looked too round). No component uses a fully round pill shape. One setting controls the whole app, so change the three tokens, not individual components.

### Shadow

Depth comes from three layers: canvas, paper cards, raised surfaces. Shadows are soft and neutral; in dark the lighter surface does the lifting.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `shadow-1` | `0 1px 2px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.06)` | `0 1px 2px rgba(0,0,0,0.5)` | Cards, panels, the section list, banners, permission pills. |
| `shadow-bar` | `0 1px 3px rgba(0,0,0,0.08)` | `0 1px 0 rgba(255,255,255,0.06)` | Sticky bars: the strip under the header, bottom action bars. |
| `shadow-button` | `0 2px 6px rgba(0,0,0,0.22)` | `0 2px 6px rgba(0,0,0,0.6)` | Primary buttons and the selected segment: lifts the one thing to press. |
| `shadow-control` | `0 1px 2px rgba(0,0,0,0.08)` | `0 1px 2px rgba(0,0,0,0.5)` | Secondary buttons on a sunken fill. |
| `shadow-3` | `0 12px 32px rgba(0,0,0,0.28)` | `0 12px 32px rgba(0,0,0,0.7)` | Dialogs and sheets above the overlay. |
| `shadow-inset` | `inset 0 1px 2px rgba(0,0,0,0.06)` | `inset 0 1px 2px rgba(0,0,0,0.4)` | Inputs: reads as a well you type into. |

### Border

Lines only where they carry meaning: inputs, dashed status, red conflict, faint row dividers.

| Token | Value | Use |
| --- | --- | --- |
| `border-strong` | 2px | Conflict rows and dialogs in red, dashed empty states. |
| `border-chip` | 1.5px | Input borders, status badges, danger buttons. |
| `border-hairline` | 1px | Row dividers in rule colour. |

### Size

Touch first: crews tap with gloves, in a hurry, standing.

| Token | Value | Use |
| --- | --- | --- |
| `touch-min` | 44px | Minimum height of every tappable control. Table rows are 52px. |
| `row-height` | 52px | Shot list, cast, crew and scene rows. |
| `sidebar-width` | 232px | Section list when open on landscape and desktop. |
| `rail-width` | 64px | Section list when collapsed to icons. |

### Slate look (applied)

The look follows the Slate page of the LineBoard 2.0 design canvas: Barlow Condensed (caps, letter-spaced) for titles, labels, numbers, badges and buttons, Barlow for text, Courier Prime for script (the script PDF keeps Courier). The fonts are bundled with the app, so they work offline. Cards and dialogs have 10px corners. Tally red is #D7140F (dark #FF453A) and stale amber text #7A4A00 (dark #F2B33D). Overview shows the next shoot day and the latest call sheet as big condensed numbers (DAY 3, REV 2). The top bar is black like Slate's, with the zebra stripes of a clapper board at its left (132px, 36px on a phone), then the app's own logo in its dark-background version, the project name and the section, role line in condensed caps, and dark buttons. The same stripes appear as a quiet accent on the sign-in card and on each project card. The storyboard shows three frames in a row. The section list (sidebar, collapsed rail and phone icon bar) follows the top bar: black in light mode, white in dark mode, with the current section inverted. Not taken from Slate: the horizontal section strip and square caps buttons. The app keeps its own logo, the sidebar and rail, the phone icon bar and sentence-case buttons.

## 26. Components

Each component below has a CSS class prefix `lb-` in the design system stylesheet (reproduced in the appendix).

### Logo

The supplied logo from `docs/lineboard-brand/` (see Design language, Logo). Never retype it.

- Top left of the top bar at 20px tall, as an `<img>` in a `<picture>` that swaps `logo/lineboard-logo-light.svg` and `-dark.svg`, with `alt="LineBoard"`. Under 360px wide, use the mark alone.
- Sign-in and account screens use the full logo larger, with clear space of at least the stick's height on every side.
- Favicon, home-screen icon and PWA icons come from `icons/` in the same folder. Wire them into the page head and the web app manifest as `LOGO.md` shows.
- Never put it in a box and never recolour it.

### Button

A 44px-tall raised key; primary is filled with `ink` and lifted with `shadow-button`, used once per screen for the thing the screen is for.

- `lb-btn` secondary (`surface-sunken` fill, `shadow-control`), `lb-btn--primary` (ink fill, `on-ink` text), `lb-btn--danger` (`red` ring and text on `paper`, for delete and reject), `lb-btn--sm` (36px, inside table rows only).
- Pressed, a button drops 1px and loses its shadow.
- Labels are verbs in sentence case: "Publish Rev 3", "Add shot", "Keep mine".
- An icon goes before the label, never alone without an `aria-label`.
- Disabled buttons drop to 35% opacity. Prefer explaining why next to the button over disabling it.

### SegmentedControl

A row of options in a `surface-sunken` track; the selected option is filled with `ink` and raised with `shadow-button`.

- Use for switching views of the same thing (Shot list / Storyboard, Equipment / Props, the steps of an import) and, with `lb-seg--full`, as a full-width row of options.
- Two to five options. More than five belongs in the section list.
- Mark the selected option with `aria-selected="true"` (tabs) or `aria-current="page"` (navigation).

### SceneChip

The scene number in a small ink-filled block; the scene is LineBoard's permanent record, so its number always looks the same.

- `lb-scene` on paper, `lb-scene--on-ink` inside a scene header row, `lb-scene--omitted` for a cut scene (dashed, struck through, kept for reference), `lb-scene--lg` in schedules and pickers.
- Inserted scenes keep their letter (42A). Mark newness with a Revised badge beside it, never by changing the chip.
- Shot numbers follow as scene-shot in `body-strong`: 42-1, 42A-1.

### StatusBadge

A small caps label that names a state with a shape and a word first and colour second.

- Locked: outline plus lock icon. Revised: `ink` fill, text starts with `*`. Omitted: dashed `outline-quiet`, struck through. Stale link: dashed `stale` plus warning icon. Conflict: 2px `red` plus cross.
- One badge per state per row. Put it after the thing it describes, never in place of it.
- Text is short and specific: "Stale link · passage changed", "* New in draft 3", "Deletes on 30 Nov 2026".
- `lb-badge--on-ink` for badges inside ink-filled header rows.

### PermissionIndicator

A pill that says what you can do here and, when you can't, who can.

- One per editable area, top right of its header: pencil "You can edit · Camera" or eye "View only".
- `lb-perm--locked` (dashed `outline-quiet`) for rows another team owns and for sections without access. Always name the owner or the person to ask.
- `lb-perm--sm` inside rows and dense headers.
- Pair a locked row with a one-line caption under the table explaining the rule.

### SectionNav

The section list. On landscape and desktop it is a full-height `side-gray` column flush with the left edge, with only its outer right edge rounded (`radius-lg`). The rows sit directly on the gray, with no card behind them. The current section is filled with `ink` and raised. Under 1000px it becomes the bottom strip (below).

- Width `sidebar-width` when open, `rail-width` when collapsed. A header row carries the toggle button on the left and the viewer's team and role as a `label` beside it.
- The toggle has no background of its own and shows a faint shade only on hover. It is at least 44px square, has `aria-expanded`, an accessible name ("Hide sections" or "Show sections"), a tooltip, and the Ctrl or Cmd + B shortcut.
- Each section has its own stroke icon (Overview, Script, Shot list, Storyboard, Breakdown, Cast and crew, Props, Equipment, Schedule, Call sheets, Team and access, Export and settings). Open, the icon sits before the section name. Collapsed, only the icon shows, with the section name as a tooltip.
- Each row carries its access on the right when open: nothing for edit, a VIEW or SOME SCENES tag, or a lock for no access. When collapsed the tag is dropped and locked sections are dimmed. Locked sections stay listed.
- A red count tag (`red`, 11px, 800) marks sections that need attention, for example stale links.
- The collapsed or open choice is remembered per device.

### SectionStrip

The phone and portrait tablet version of the section list: every section in one row along the bottom of the screen that slides sideways.

- The bar is `surface-sunken` (light gray) with `shadow-bar` and safe-area padding. Each section is a `paper` button at least 44px tall, and the current one is filled with `ink`.
- The current section scrolls into view. The right edge fades to show more sections.
- It carries the same VIEW tags and lock icons as the section list. No Sections button, no sheet.
- Research note: bottom bars are normally fixed with three to five items, and scrollable strips can hide options. The strip is used here because LineBoard has twelve sections. The fade and the scroll-to-current behaviour reduce the risk of missing one.

### ShotTable

The shot list: one `paper` card with `shadow-1`, a caps table head, an ink scene header row per scene, then one 52px row per shot split by faint `rule` hairlines.

- Columns: shot (scene-shot number), description, size and movement, lens, owning team, status.
- Rows your team owns show a pencil by the team; rows another team owns use `lb-tr--other` (`ink-muted`) and a lock.
- `lb-tr--selected` (`surface-soft`) for the selected or unsaved row. `lb-tr--conflict` outlines the row in `red` and puts a Conflict button in the status cell.
- Stale links show as a badge under the description, never by moving the row.
- Omitted scenes collapse to one dashed row with a Show button.
- The same pattern serves cast, crew, props, breakdown and schedule tables: change the columns, keep the card, head, rows and ownership.

### Banner

A one-line strip across the top of the content that reports project state without blocking work.

- `lb-banner` for calm facts (pass status, monthly reminders). `lb-banner--alert` in `red` for the final month before read-only or deletion, with one action. `lb-banner--quiet` for offline: a caps line under the top bar, persistent but small.
- One banner at a time. The most urgent wins.
- Lead with the fact in bold caps, then the consequence in plain text.

### Dialog

A `paper` card raised with `shadow-3` over an `overlay` scrim, for decisions that must be made before work continues.

- Use for edit conflicts, deleting a project, revoking a code and leaving with unsaved changes. Not for information.
- Structure: optional status badge, `heading` question or statement, one `caption` line of context, the choice, then actions with the primary on the right.
- Conflicts show both versions field by field with `lb-choice` options; unchanged fields are listed as "Same in both".
- Destructive dialogs use `lb-btn--danger` for the final action and ask for an export first where data will be lost.

### EmptyState

A dashed `outline-quiet` box that says what will appear here and offers the first step.

- Every section has one: name the thing in bold, say how it fills, offer one button.
- Also used for locked placeholders (storyboard frames on the free tier, offline frames) with the reason instead of a button.
- Never a blank area, never an illustration.

### Field

A caps label over a 44px input: a `paper` well with a 1.5px `outline-quiet` border and `shadow-inset`, turning `ink` on focus.

- Labels are `label` style in `ink-subtle`, always visible, never placeholder-only.
- Read-only values (draft number, locked scene number) use `lb-input--ro`: `surface-sunken` fill and a dashed border.
- When the connection drops mid-edit, keep the value and show `lb-held` under the field: "Not saved yet. Sends when you're back online."
- Times and counts use `body-strong` or the script face only where the brief says so.

### Screen composition rules

- Landscape and desktop: top bar in `paper` with `shadow-bar` holding the logo, project and role, and screen actions. The full-height gray section list sits flush at the left, collapsible to an icon rail. Content cards sit on `canvas` to the right with `space-5` padding.
- Portrait tablet and phone: no side list. The section strip slides along the bottom.
- Both light and dark themes are required. Provide tablet landscape, tablet portrait and phone layouts for every screen.
- Every editable area shows a permission pill. Every row shows its owning team. Every lock states a reason and who can change it.
- One banner at a time. The most urgent wins.
- No exclamation marks and no emoji anywhere in interface text.


## Appendix: reference stylesheet

> Where this appendix differs from sections 24 to 26 (the radius values, the logo, the section list and the bottom strip), sections 24 to 26 are correct. The working stylesheet is `app/src/index.css`.

The design system's component stylesheet, reproduced as the exact reference for sizes, states and behaviour. It uses the tokens above as CSS custom properties (`--paper`, `--ink`, `--shadow-1` and so on, plus `--font-sans`, `--font-script`).

```css
/* LineBoard components. Built on tokens.css. Prefix: lb-
   Layers: canvas (0) > paper cards with shadow-1 (1) > dialogs with shadow-3 (2). Sunken fills sit inside cards. */
.lb-preview{background:var(--canvas);color:var(--ink);font-family:var(--font-sans);font-size:15px;line-height:1.45;padding:20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;-webkit-font-smoothing:antialiased;box-sizing:border-box}
.lb-preview--col{flex-direction:column;align-items:stretch}
.lb-icon{width:14px;height:14px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}

/* Wordmark */
.lb-wordmark{font-family:var(--font-sans);font-size:20px;font-weight:800;letter-spacing:.02em;color:var(--ink)}
.lb-wordmark span{color:var(--red)}
.lb-wordmark--lg{font-size:52px;letter-spacing:.01em}

/* Card: the basic layer-1 surface */
.lb-box,.lb-card{background:var(--paper);border-radius:var(--radius-lg);box-shadow:var(--shadow-1);overflow:hidden}
.lb-card{padding:16px}

/* Button */
.lb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--touch-min);padding:0 16px;box-sizing:border-box;border:0;border-radius:var(--radius-md);background:var(--surface-sunken);color:var(--ink);box-shadow:var(--shadow-control);font-family:var(--font-sans);font-size:14px;font-weight:700;white-space:nowrap;cursor:pointer;text-decoration:none;transition:transform .08s ease,box-shadow .12s ease}
.lb-btn:active{transform:translateY(1px);box-shadow:none}
.lb-btn--primary{background:var(--ink);color:var(--on-ink);box-shadow:var(--shadow-button)}
.lb-btn--danger{background:var(--paper);color:var(--red);box-shadow:inset 0 0 0 var(--border-chip) var(--red)}
.lb-btn--sm{min-height:36px;padding:0 12px;font-size:12px}
.lb-btn:disabled{opacity:.35;cursor:not-allowed;box-shadow:none}
.lb-btn:focus-visible,.lb-seg button:focus-visible,.lb-nav a:focus-visible,.lb-input:focus-visible,.lb-choice:focus-visible{outline:3px solid var(--ink);outline-offset:2px}

/* Segmented control: a sunken track, the selected segment raised in ink */
.lb-seg{display:inline-flex;gap:3px;padding:3px;border-radius:calc(var(--radius-md) + 3px);background:var(--surface-sunken)}
.lb-seg button{min-height:38px;padding:0 18px;border:0;border-radius:var(--radius-md);background:transparent;color:var(--ink-muted);font-family:var(--font-sans);font-size:14px;font-weight:700;cursor:pointer}
.lb-seg button[aria-selected="true"],.lb-seg button[aria-current="page"]{background:var(--ink);color:var(--on-ink);box-shadow:var(--shadow-button)}
.lb-seg--full{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);width:100%;box-sizing:border-box;background:var(--paper);box-shadow:var(--shadow-1)}
.lb-seg--full button{min-height:var(--touch-min);padding:0 4px;font-size:12px}

/* Scene chip */
.lb-scene{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:26px;padding:0 6px;box-sizing:border-box;border-radius:var(--radius-sm);background:var(--ink);color:var(--on-ink);font-family:var(--font-sans);font-size:14px;font-weight:800}
.lb-scene--on-ink{background:var(--paper);color:var(--ink)}
.lb-scene--omitted{background:transparent;color:var(--ink-subtle);border:var(--border-chip) dashed var(--outline-quiet);text-decoration:line-through}
.lb-scene--lg{min-width:60px;height:40px;font-size:20px}

/* Status badge */
.lb-badge{display:inline-flex;align-items:center;gap:var(--space-1);min-height:24px;padding:0 8px;box-sizing:border-box;border:var(--border-chip) solid transparent;border-radius:6px;background:var(--surface-sunken);color:var(--ink);font-family:var(--font-sans);font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.lb-badge .lb-icon{width:12px;height:12px;stroke-width:2.6}
.lb-badge--revised{background:var(--ink);color:var(--on-ink)}
.lb-badge--omitted{background:transparent;border-style:dashed;border-color:var(--outline-quiet);color:var(--ink-subtle);text-decoration:line-through}
.lb-badge--stale{background:transparent;border-style:dashed;border-color:var(--stale);color:var(--stale)}
.lb-badge--conflict{background:var(--paper);border-width:var(--border-strong);border-color:var(--red);color:var(--red)}
.lb-badge--on-ink{background:transparent;border-color:var(--on-ink);color:var(--on-ink)}

/* Permission indicator */
.lb-perm{display:inline-flex;align-items:center;gap:8px;min-height:var(--touch-min);padding:0 14px;box-sizing:border-box;border:var(--border-chip) solid transparent;border-radius:999px;background:var(--paper);box-shadow:var(--shadow-1);font-family:var(--font-sans);font-size:14px;font-weight:700;color:var(--ink)}
.lb-perm--locked{background:transparent;box-shadow:none;border-style:dashed;border-color:var(--outline-quiet);color:var(--ink-muted)}
.lb-perm--sm{min-height:32px;font-size:12px;padding:0 10px}

/* Label */
.lb-label{font-family:var(--font-sans);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-subtle)}

/* Section nav: a card, the current section raised in ink */
.lb-nav{display:flex;flex-direction:column;gap:2px;width:var(--sidebar-width);padding:6px;box-sizing:border-box;border-radius:var(--radius-lg);background:var(--paper);box-shadow:var(--shadow-1)}
.lb-nav a{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:var(--touch-min);padding:0 12px;border-radius:var(--radius-md);color:var(--ink);text-decoration:none;font-family:var(--font-sans);font-size:14px;font-weight:700}
.lb-nav a[aria-current="page"]{background:var(--ink);color:var(--on-ink);box-shadow:var(--shadow-button)}
.lb-nav a.is-locked{color:var(--ink-subtle)}
.lb-nav .lb-tag{font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--ink-subtle)}
.lb-nav a[aria-current="page"] .lb-tag{color:var(--on-ink)}

/* Shot table: rows on a card, faint dividers */
.lb-thead,.lb-tr{display:grid;grid-template-columns:64px minmax(0,1fr) 110px 64px 124px 96px;gap:var(--space-3);align-items:center;padding:0 16px}
.lb-thead{min-height:40px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-subtle)}
.lb-scenehead{display:flex;align-items:center;gap:10px;padding:8px 16px;background:var(--ink);color:var(--on-ink);font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.lb-scenehead .lb-end{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-weight:700}
.lb-tr{min-height:var(--row-height);border-bottom:var(--border-hairline) solid var(--rule);font-size:15px}
.lb-tr:last-child{border-bottom:0}
.lb-tr--selected{background:var(--surface-soft)}
.lb-tr--other{color:var(--ink-muted)}
.lb-tr--conflict{box-shadow:inset 0 0 0 var(--border-strong) var(--red)}
.lb-shotno{font-weight:800}
.lb-team{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700}

/* Banner */
.lb-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--touch-min);padding:0 16px;box-sizing:border-box;border-radius:var(--radius-md);background:var(--paper);box-shadow:var(--shadow-1);font-family:var(--font-sans);font-size:13px;color:var(--ink)}
.lb-banner b{font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.lb-banner--alert{color:var(--red);box-shadow:var(--shadow-1),inset 0 0 0 var(--border-strong) var(--red)}
.lb-banner--quiet{justify-content:flex-start;gap:8px;border-radius:0;background:var(--surface-sunken);box-shadow:none;color:var(--ink-muted);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}

/* Dialog: layer 2 */
.lb-scrim{background:var(--overlay);padding:24px;display:flex;align-items:center;justify-content:center}
.lb-dialog{width:100%;max-width:520px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:22px;border-radius:var(--radius-lg);background:var(--paper);box-shadow:var(--shadow-3);color:var(--ink);font-family:var(--font-sans)}
.lb-dialog h2{margin:0;font-size:20px;font-weight:800;line-height:1.2}
.lb-dialog p{margin:0;font-size:14px;color:var(--ink-muted)}
.lb-dialog .lb-actions{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
.lb-choice{min-height:var(--touch-min);padding:8px 12px;text-align:left;border:0;border-radius:var(--radius-md);background:var(--surface-sunken);color:var(--ink);font-family:var(--font-sans);font-size:14px;cursor:pointer}
.lb-choice[aria-checked="true"]{background:var(--ink);color:var(--on-ink);font-weight:600;box-shadow:var(--shadow-button)}

/* Empty state */
.lb-empty{border:var(--border-strong) dashed var(--outline-quiet);border-radius:var(--radius-lg);padding:28px 18px;text-align:center;color:var(--ink-subtle);font-family:var(--font-sans);font-size:13px;line-height:1.6}
.lb-empty strong{display:block;color:var(--ink);font-size:15px;font-weight:800}

/* Field */
.lb-field{display:flex;flex-direction:column;gap:4px;font-family:var(--font-sans)}
.lb-field label{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-subtle)}
.lb-input{min-height:var(--touch-min);padding:0 12px;box-sizing:border-box;border:var(--border-chip) solid var(--outline-quiet);border-radius:var(--radius-md);background:var(--paper);box-shadow:var(--shadow-inset);color:var(--ink);font-family:var(--font-sans);font-size:15px}
.lb-input:focus{border-color:var(--ink)}
.lb-input--ro{background:var(--surface-sunken);border-style:dashed;box-shadow:none}
.lb-held{font-size:12px;font-weight:600;color:var(--ink-subtle)}
```
