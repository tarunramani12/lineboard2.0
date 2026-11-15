import { useQueries, useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export const MET_CREDIT = 'Weather data from MET Norway'
export interface DayWeather { summary: string; sunrise: string; sunset: string; reason?: 'too_far' }

/** MET Norway's forecast reaches about 9 days ahead. */
export function withinForecast(date: string, now = new Date()): boolean {
  const d = Date.parse(date + 'T12:00:00Z'), t = Date.parse(now.toISOString().slice(0, 10) + 'T12:00:00Z')
  const days = Math.round((d - t) / 86400000)
  return days >= 0 && days <= 9
}

/** Ask the weather function (it adds the header MET Norway requires and remembers answers for 30 minutes). */
export async function fetchWeather(lat: number, lng: number, date: string): Promise<DayWeather> {
  const { data, error } = await supabase.functions.invoke('weather', { body: { lat, lng, date } })
  if (error) throw error
  return data as DayWeather
}

export const useWeather = (lat: number | null, lng: number | null, date: string | null) => useQuery({
  queryKey: ['weather', lat?.toFixed(4), lng?.toFixed(4), date],
  enabled: lat != null && lng != null && Boolean(date) && withinForecast(date!),
  staleTime: 30 * 60 * 1000,
  retry: 0,
  queryFn: () => fetchWeather(lat!, lng!, date!),
})

/** One forecast line per location for a shoot day, as text ('' when none is available). */
export function useDayWeather(locs: { id: string; lat: number | null; lng: number | null }[], date: string | undefined): Map<string, string> {
  const results = useQueries({
    queries: locs.map((l) => ({
      queryKey: ['weather', l.lat?.toFixed(4), l.lng?.toFixed(4), date],
      enabled: l.lat != null && l.lng != null && Boolean(date) && withinForecast(date!),
      staleTime: 30 * 60 * 1000, retry: 0,
      queryFn: () => fetchWeather(l.lat!, l.lng!, date!),
    })),
  })
  return new Map(locs.map((l, i) => [l.id, results[i]?.data?.summary ?? '']))
}
