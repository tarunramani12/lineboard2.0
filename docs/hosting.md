# Putting LineBoard online at lineboard.app

LineBoard's front end is a set of static files. The database, sign-in and storage already live on Supabase, so only the files need a host. The host chosen is Cloudflare Pages: free, no meter on page traffic, allowed for a business, and the domain is already at Cloudflare.

Nothing in this file has been done yet. Each step is done by the owner, in their own accounts. Keys and passwords are never put in this repository, in chat, or in any file.

## What is already prepared in the code
- `app/public/_headers` tells Cloudflare how to cache: the pages and the service worker are never cached (so an update reaches everyone), the fingerprinted files in `/assets` are cached for a year, and a few safe headers are added.
- Single-page routing works: a direct link such as `/p/<id>/script` opens the app (Pages serves `index.html` for unknown paths when there is no `404.html`). Tested with the production build.
- Sign-in and password-reset links use the address the app is opened from, so they point at `https://lineboard.app` once it is served from there.
- The fonts are bundled and cached by the service worker. The production build makes no request to any site except Supabase.

## Steps for the owner
1. **GitHub.** Make a free account if needed. Create a PRIVATE repository named `lineboard`. Tell Claude the repository address. Claude then makes the first commit (after checking that no key is tracked) and pushes, only when told to.
2. **Cloudflare Pages.** In the Cloudflare dashboard: Workers and Pages, Create, Pages, Connect to Git, choose `lineboard`. Settings:
   - Framework preset: Vite (or None)
   - Root directory: `app`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables (type them into Cloudflare, never into chat): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (both are in `app/.env.local`), and `NODE_VERSION` = `22`
3. **Custom domain.** In the Pages project, Custom domains, Set up a domain, enter `lineboard.app`. Cloudflare adds the DNS record by itself. Optionally add `www.lineboard.app` too.
4. **Supabase.** Dashboard, Authentication, URL Configuration: set Site URL to `https://lineboard.app` and add `https://lineboard.app/**` to Redirect URLs. Keep `http://localhost:5173/**` so development still works. In Authentication, switch on leaked password protection.
5. **Try it.** Open `https://lineboard.app` on the iPad and phone, create an account, create a project, then delete both. Add to Home Screen.

## Updating the app later
Push a change to the `main` branch and Cloudflare builds and publishes it by itself, usually in a couple of minutes. Each build is kept, so a bad one is undone in the Pages dashboard with Rollback.

## Costs
- Hosting: free.
- Domain: renewed yearly at Cloudflare (about 10 to 15 euro).
- Supabase: the free plan is fine for testing. Before charging customers, move to the paid plan (about 25 dollars a month, check the current price) for backups and higher limits.
- Email: Resend free to start (3,000 a month, 100 a day), about 20 dollars a month later.

## Not covered here
Email (next, see the planning document section 19), the keep-alive workflow (`.github/workflows/keepalive.yml`, which needs the two repository secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`), and the App Store and Play Store (later, through a Capacitor wrapper, only when customers ask).
