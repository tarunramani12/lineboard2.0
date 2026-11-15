// Pure helpers for the weather function (tested from Node, no Deno needed).
export interface Forecast {
  summary: string; symbol: string; tmin: number | null; tmax: number | null; rain_mm: number | null; wind_ms: number | null
  sunrise: string; sunset: string; reason?: 'too_far'
}
interface Step { time: string; data: { instant: { details: { air_temperature?: number; wind_speed?: number } }; next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } }; next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } } } }

/** The UTC offset of a time zone on a date, as +HH:MM, from the zone's own rules (so daylight saving is right). */
export function offsetOn(tz: string, date: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(date + 'T12:00:00Z')).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part)
  if (!m) return '+00:00'
  return `${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}`
}
const minutes = (off: string) => (off[0] === '-' ? -1 : 1) * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6)))

const WORDS: Record<string, string> = {
  clearsky: 'Clear', fair: 'Mostly clear', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog', rain: 'Rain', lightrain: 'Light rain', heavyrain: 'Heavy rain',
  rainshowers: 'Rain showers', lightrainshowers: 'Light showers', heavyrainshowers: 'Heavy showers', sleet: 'Sleet', lightsleet: 'Light sleet', heavysleet: 'Heavy sleet',
  snow: 'Snow', lightsnow: 'Light snow', heavysnow: 'Heavy snow', snowshowers: 'Snow showers', lightsnowshowers: 'Light snow showers', heavysnowshowers: 'Heavy snow showers',
}
export function symbolWord(code: string): string {
  const base = code.replace(/_(day|night|polartwilight)$/, '')
  if (base.includes('andthunder')) return 'Thunderstorms'
  return WORDS[base] ?? 'Mixed'
}

/** One shoot day (6:00 to 21:00 local) from MET Norway's hourly forecast, plus the sun times. Returns reason too_far when the forecast does not reach that day. */
export function summarise(date: string, offset: string, steps: Step[], sun: { sunrise?: string; sunset?: string }): Forecast {
  const off = minutes(offset) * 60000
  const local = (t: string) => new Date(new Date(t).getTime() + off).toISOString()
  const day = steps.filter((s) => { const l = local(s.time); const h = Number(l.slice(11, 13)); return l.slice(0, 10) === date && h >= 6 && h <= 21 })
  const hhmm = (t?: string) => (t ? t.slice(11, 16) : '')
  const empty: Forecast = { summary: '', symbol: '', tmin: null, tmax: null, rain_mm: null, wind_ms: null, sunrise: hhmm(sun.sunrise), sunset: hhmm(sun.sunset), reason: 'too_far' }
  if (!day.length) return empty
  const temps = day.map((s) => s.data.instant.details.air_temperature).filter((x): x is number => typeof x === 'number')
  const winds = day.map((s) => s.data.instant.details.wind_speed).filter((x): x is number => typeof x === 'number')
  const rain = Math.round(day.reduce((n, s) => n + (s.data.next_1_hours?.details?.precipitation_amount ?? s.data.next_6_hours?.details?.precipitation_amount ?? 0), 0) * 10) / 10
  const noon = [...day].sort((a, b) => Math.abs(Number(local(a.time).slice(11, 13)) - 12) - Math.abs(Number(local(b.time).slice(11, 13)) - 12))[0]
  const symbol = noon.data.next_6_hours?.summary?.symbol_code ?? noon.data.next_1_hours?.summary?.symbol_code ?? ''
  const tmin = temps.length ? Math.round(Math.min(...temps)) : null, tmax = temps.length ? Math.round(Math.max(...temps)) : null
  const wind = winds.length ? Math.round(Math.max(...winds)) : null
  const parts = [
    symbol ? symbolWord(symbol) : '',
    tmin !== null && tmax !== null ? (tmin === tmax ? `${tmin} C` : `${tmin} to ${tmax} C`) : '',
    rain > 0 ? `rain ${rain} mm` : 'no rain expected',
    wind !== null ? `wind up to ${wind} m/s` : '',
    sun.sunrise ? `sunrise ${hhmm(sun.sunrise)}` : '', sun.sunset ? `sunset ${hhmm(sun.sunset)}` : '',
  ].filter(Boolean)
  return { summary: parts.join(', '), symbol, tmin, tmax, rain_mm: rain, wind_ms: wind, sunrise: hhmm(sun.sunrise), sunset: hhmm(sun.sunset) }
}
