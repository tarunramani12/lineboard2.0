// Keeps the free Supabase project from pausing after a week of no use.
// It makes one small, read-only request. It needs two environment values and prints nothing secret:
//   SUPABASE_URL       the project address, for example https://abcd1234.supabase.co
//   SUPABASE_ANON_KEY  the public (anon) key
// Run it by hand with:  node scripts/keepalive.mjs   or let the GitHub workflow in .github/workflows/keepalive.yml run it every day.
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY.'); process.exit(1) }
const base = url.replace(/\/$/, '')
const headers = { apikey: key, Authorization: `Bearer ${key}` }
// 1. The sign-in service answers publicly, which also shows the key and address are right.
const auth = await fetch(`${base}/auth/v1/settings`, { headers })
// 2. A read through the data service reaches the database itself. The table is protected, so an answer of 401 or 403 is the normal one.
const data = await fetch(`${base}/rest/v1/teams?select=id&limit=1`, { headers })
console.log(`Sign-in service: ${auth.status}. Data service: ${data.status}.`)
process.exit(auth.status === 200 && data.status < 500 ? 0 : 1)
