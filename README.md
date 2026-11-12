# LineBoard 2.0

Script-to-call-sheet web app for filmmakers. Tablet and phone first; laptops work too.

## Folder layout
- `app/`  – Vite + React + TypeScript + Tailwind v4, installable PWA, Supabase client
- `docs/` – design brief (`LineBoard-2.0-design-prompt.md`) and planning document (`planning-document.md`)

## Come back and run it again
```
cd /Users/tarun/Documents/Projects/LineBoard_2.0/app
npm run ipad        # dev server reachable from other devices on your Wi-Fi
```
- On the Mac: http://localhost:5173
- On the iPad (same Wi-Fi): Safari -> `http://<your Mac's IP>:5173`
  - Find the IP with: `ipconfig getifaddr en0` (it was 192.168.178.91 on 2026-11-10 but can change)
  - Tap Share -> Add to Home Screen for an app icon.
- If the iPad can't connect: check the macOS firewall isn't blocking Node, and that both devices are on the same network.
- Stop the server with Ctrl+C (or `pkill -f vite` if it was left running in the background).

Other commands: `npm run build`, `npm test`.

## What exists today (the real build, base step)
- Sign up, sign in, password reset, join with a code, projects list, account settings (`src/pages/Account.tsx`).
- Project shell: top bar, section list (locks and VIEW tags), phone bottom bar, More sheet, offline banner (`src/components/ProjectLayout.tsx`).
- Overview, Scenes with locking (`src/pages/Scenes.tsx`), Team and access: teams, people, edit grants, join codes, invites, permission matrix, script sharing (`src/pages/TeamAccess.tsx`), Export and settings (delete or leave project).
- All other sections show their permission state and an empty state until their build step.
- Backend: Supabase. Schema and permission rules are in `supabase/migrations/` and are enforced by the database. Run the permission tests with `cd supabase/tests && npm install && npm test`.
- Keys live only in `app/.env.local` (git-ignored). Never commit them.
- The old localStorage prototype was replaced.

## Next steps
Script writing and import, then shot list, breakdown, cast and crew, schedule, call sheets. See `docs/planning-document.md` and `docs/base-design.md`.
