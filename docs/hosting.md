# Hosting: how LineBoard is online at lineboard.app

Status: LIVE since 2026-11-12. This file records what was done and how to repeat or change it. No keys or passwords are written here or anywhere in the repository. Secrets live only in `app/.env.local` (on the owner's Mac, ignored by git), in Cloudflare and Supabase settings, and in GitHub repository secrets.

## The pieces and where they live
| Piece | Service | Notes |
|---|---|---|
| Website files (the React app) | Cloudflare Pages, project `lineboard` | Free. Direct upload from the owner's Mac (not linked to GitHub). |
| Domain `lineboard.app` | Cloudflare (registrar and DNS) | Bought by the owner. `lineboard.app` and `www.lineboard.app` are proxied CNAMEs to `lineboard.pages.dev`. |
| Temporary address | `https://lineboard.pages.dev` | Same site. Also listed in Supabase redirect URLs. |
| Database, sign-in, files, Edge Functions | Supabase (project in the owner's account) | Free plan for now. See `docs/operations.md` for costs and upgrade advice. |
| Code | GitHub, private repo `tarunramani12/lineboard2.0`, branch `main` | |
| Daily keep-alive | GitHub Actions, `.github/workflows/keepalive.yml` | Repo secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set. Prevents the free Supabase project from pausing. |
| Email | Resend (see `docs/email.md`) | |

## What the code does for hosting
- `app/public/_headers`: `index.html`, the service worker and the manifest are never cached (an update reaches everyone), files in `/assets` are cached for a year (they are fingerprinted), plus nosniff, referrer, permissions and frame headers.
- Single-page routing: a direct link such as `/p/<id>/script` opens the app, because Pages serves `index.html` for unknown paths.
- Sign-in and password-reset links use `window.location.origin`, so they point at whatever address the app was opened from. Supabase must list that address (below).
- Fonts are bundled and cached by the service worker. The production build makes no request to any site except Supabase (and Resend is called only from the Edge Function, never from the browser).

## How the live site was set up (done)
1. GitHub repo created by the owner; first commit pushed (`gh auth login`, HTTPS).
2. Build with the two Vite variables from `app/.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
3. Cloudflare Pages project created from the terminal: `npx wrangler pages project create lineboard --production-branch main --force`. The plain command tried to use Workers and stopped because the account had no workers.dev subdomain. `--force` creates a classic Pages project, which needs none. Never pass `--force` again; the project exists.
4. Custom domains added in the dashboard: Workers and Pages, `lineboard`, Custom domains: `lineboard.app` and `www.lineboard.app`. Both need a proxied CNAME to `lineboard.pages.dev` in the domain's DNS.
5. Supabase, Authentication, URL Configuration: Site URL `https://lineboard.app`; Redirect URLs `https://lineboard.app/**`, `https://www.lineboard.app/**`, `https://lineboard.pages.dev/**`, and the localhost entry kept for development.

## Deploying an update (every time the app code changes)
Run from the `app` folder on the owner's Mac:
```
set -a; . ./.env.local; set +a
npm run build
npx wrangler pages deploy dist --project-name lineboard --branch main --commit-dirty=true
```
- The Supabase address and public key are baked into the build from `.env.local`, so build on the machine that has that file.
- `wrangler login` (browser approval) is needed once per machine. It stores its token on the Mac, outside the repo.
- After a wrangler run, check `git status`. Wrangler can auto-configure a project: it once rewrote `app/vite.config.ts`, added `@cloudflare/vite-plugin` to `package.json`, and created `app/wrangler.jsonc` and an `app/.env.example` containing real values. All of that was reverted. Do not commit those. Revert with `git checkout -- app/vite.config.ts app/package.json app/package-lock.json app/.gitignore` and delete the extra files.
- Rollback: Cloudflare dashboard, Workers and Pages, `lineboard`, Deployments, pick an earlier deployment, Rollback.
- To make Cloudflare build on every push to `main` instead, connect the Pages project to the GitHub repo in the dashboard (root `app`, build `npm run build`, output `dist`, variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION=22`). That would be a new Pages project (a direct-upload project cannot be switched to Git). Not done.

## Things that went wrong once, and why
- Chrome showed DNS_PROBE_FINISHED_NXDOMAIN while Safari worked: the owner's home router had cached "this name does not exist" from before the DNS record was added. Public resolvers were correct. Fix: wait, restart the router, or set the Mac's DNS to 1.1.1.1 and 8.8.8.8.
- `.app` domains only allow secure connections; always type `https://`.

## Still to do
- Leaked-password protection in Supabase (Authentication, Sign In / Providers, Email); it may need a paid plan.
- Test on the iPad and phone with Add to Home Screen.
- Supabase's own sign-up and password-reset mail through Resend (see `docs/email.md`).
- App Store and Play Store (Capacitor wrapper), only when customers ask; Google Play first ($25 once; Apple is $99 a year).
