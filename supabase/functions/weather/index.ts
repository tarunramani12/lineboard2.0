// Weather for one place and one shoot day, from MET Norway (free for commercial use with credit: "Weather data from MET Norway").
// A browser cannot send the identifying User-Agent MET Norway requires, so the app calls this function instead. It needs a signed-in
// person (verify_jwt), rounds coordinates to 4 decimals, and remembers each answer for 30 minutes.
import tzlookup from 'npm:tz-lookup@6.1.25'
import { offsetOn, summarise } from './forecast.ts'

const UA = 'LineBoard/1.0 (https://lineboard.app)'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const cache = new Map<string, { at: number; body: unknown }>()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { lat, lng, date } = await req.json()
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return json({ error: 'bad_request' }, 400)
    const la = Math.round(lat * 1e4) / 1e4, lo = Math.round(lng * 1e4) / 1e4
    const key = `${la},${lo},${date}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < 30 * 60_000) return json(hit.body)
    const tz = tzlookup(la, lo)
    const offset = offsetOn(tz, date)
    const [f, s] = await Promise.all([
      fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`, { headers: { 'User-Agent': UA } }),
      fetch(`https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${la}&lon=${lo}&date=${date}&offset=${encodeURIComponent(offset)}`, { headers: { 'User-Agent': UA } }),
    ])
    if (!f.ok) return json({ error: 'upstream' }, 502)
    const fc = await f.json()
    const sun = s.ok ? (await s.json())?.properties ?? {} : {}
    const out = summarise(date, offset, fc?.properties?.timeseries ?? [], { sunrise: sun.sunrise?.time, sunset: sun.sunset?.time })
    cache.set(key, { at: Date.now(), body: out })
    if (cache.size > 500) cache.delete(cache.keys().next().value as string)
    return json(out)
  } catch {
    return json({ error: 'failed' }, 500)
  }
})
