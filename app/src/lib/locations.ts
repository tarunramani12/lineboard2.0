import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { isOwnerOrAdmin, type Bundle } from './project'
import type { Stroke } from './storyboard'

export const LOC_BUCKET = 'locations'

export type LocStatus = 'idea' | 'shortlisted' | 'scouted' | 'locked' | 'rejected'
export type PermitStatus = 'none' | 'to_apply' | 'applied' | 'approved'
export interface LocLink { label: string; url: string }
export interface Loc {
  id: string; project_id: string; name: string; kind: string; int_ext: '' | 'INT' | 'EXT' | 'INT/EXT'; status: LocStatus
  address: string; lat: number | null; lng: number | null; parking: string; access_restrictions: string; hospital: string
  permit_required: boolean; permit_status: PermitStatus; permit_no: string; agreement_signed: boolean
  notes: string; links: LocLink[]; locked_at: string | null; created_at: string; updated_at: string
}
export interface LocContact { location_id: string; project_id: string; name: string; role: string; phone: string; email: string }
export type CostStatus = 'quoted' | 'agreed' | 'invoiced' | 'paid'
export interface LocCost {
  id: string; location_id: string; project_id: string; kind: string; amount: number; currency: string; quantity: number
  status: CostStatus; due_date: string | null; paid_date: string | null; note: string
}
export type SceneRank = 'first' | 'alternate'
export interface LocScene { location_id: string; scene_id: string; rank: SceneRank }
export type AvailKind = 'available' | 'unavailable' | 'booked'
export interface LocAvail { id: string; location_id: string; start_date: string; end_date: string; kind: AvailKind; day_id: string | null; note: string }
export interface LocPhoto { id: string; location_id: string; path: string; bytes: number; caption: string; position: number; strokes: Stroke[]; created_at: string }

export const STATUSES: LocStatus[] = ['idea', 'shortlisted', 'scouted', 'locked', 'rejected']
export const STATUS_LABEL: Record<LocStatus, string> = { idea: 'Idea', shortlisted: 'Shortlisted', scouted: 'Scouted', locked: 'Locked', rejected: 'Rejected' }
/** The statuses a person can pick by hand. Locked is set by the Lock button, which checks the agreement and the costs. */
export const PICKABLE: LocStatus[] = ['idea', 'shortlisted', 'scouted', 'rejected']
export const PERMIT_LABEL: Record<PermitStatus, string> = { none: 'Not started', to_apply: 'To apply', applied: 'Applied', approved: 'Approved' }
export const COST_STATUS_LABEL: Record<CostStatus, string> = { quoted: 'Quoted', agreed: 'Agreed', invoiced: 'Invoiced', paid: 'Paid' }
export const AVAIL_LABEL: Record<AvailKind, string> = { available: 'Available', unavailable: 'Not available', booked: 'Booked' }

// Ready-made lists for the Choice dropdowns (values already used in the project are added by the dropdown).
export const KIND_DEFAULTS = ['House', 'Flat', 'Street', 'Shop', 'Office', 'Studio', 'Outdoors', 'Other']
export const COST_KINDS = ['Location fee', 'Deposit', 'Permit fee', 'Parking', 'Overtime', 'Insurance', 'No charge', 'Other']
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'INR', 'CAD', 'AUD']

export interface LocationsData {
  locs: Loc[]
  contacts: Map<string, LocContact>
  costs: Map<string, LocCost[]>
  scenes: Map<string, LocScene[]>          // by location
  firstOf: Map<string, string>             // scene id -> location id that is its first choice
  avail: Map<string, LocAvail[]>
  photos: Map<string, LocPhoto[]>
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export function useLocations(pid: string | undefined) {
  return useQuery({
    queryKey: ['locations', pid],
    enabled: Boolean(pid),
    refetchInterval: 20_000,
    queryFn: async (): Promise<LocationsData> => {
      const [l, c, k, s, a, p] = await Promise.all([
        supabase.from('locations').select('*').eq('project_id', pid!),
        supabase.from('location_contacts').select('*').eq('project_id', pid!),
        supabase.from('location_costs').select('*').eq('project_id', pid!),     // the database returns costs only to those who may see them
        supabase.from('location_scenes').select('*').eq('project_id', pid!),
        supabase.from('location_availability').select('*').eq('project_id', pid!),
        supabase.from('location_photos').select('*').eq('project_id', pid!),
      ])
      for (const r of [l, c, k, s, a, p]) if (r.error) throw r.error
      const locs = (l.data as Loc[]).map((x) => ({ ...x, lat: num(x.lat), lng: num(x.lng) })).sort((x, y) => x.name.localeCompare(y.name))
      const group = <T extends { location_id: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) m.set(r.location_id, [...(m.get(r.location_id) ?? []), r]); return m }
      const costs = group((k.data as LocCost[]).map((x) => ({ ...x, amount: Number(x.amount), quantity: Number(x.quantity) })))
      for (const [id, list] of costs) costs.set(id, list.sort((x, y) => x.kind.localeCompare(y.kind)))
      const scenes = group(s.data as LocScene[])
      const firstOf = new Map<string, string>()
      for (const r of s.data as LocScene[]) if (r.rank === 'first') firstOf.set(r.scene_id, r.location_id)
      const photos = group((p.data as LocPhoto[]))
      for (const [id, list] of photos) photos.set(id, list.sort((x, y) => x.position - y.position || x.created_at.localeCompare(y.created_at)))
      return { locs, contacts: new Map((c.data as LocContact[]).map((x) => [x.location_id, x])), costs, scenes, firstOf, avail: group(a.data as LocAvail[]), photos }
    },
  })
}

/** Anyone who may see contact people: owner, admins, Production and Direction (mirrors the database). */
export const canSeeLocationContacts = (b: Bundle) =>
  isOwnerOrAdmin(b) || b.myLinks.some((l) => { const t = b.teams.find((x) => x.id === l.team_id)?.role_tag; return t === 'production' || t === 'direction' })

/** Total of a location's cost lines per currency (amount times quantity). */
export function costTotals(costs: LocCost[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of costs) m.set(c.currency, Math.round(((m.get(c.currency) ?? 0) + c.amount * c.quantity) * 100) / 100)
  return m
}
export const money = (n: number, cur: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n) } catch { return `${n.toFixed(2)} ${cur}` } }
export const totalsText = (t: Map<string, number>) => [...t].map(([cur, n]) => money(n, cur)).join(' + ')

/** Availability ranges that block a date (YYYY-MM-DD). */
export const blockedOn = (avail: LocAvail[], date: string) => avail.filter((a) => a.kind === 'unavailable' && a.start_date <= date && date <= a.end_date)

// ---- maps
const isApple = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document
const enc = encodeURIComponent
/** A link that opens the place in the maps app: Apple Maps on Apple touch devices, Google Maps elsewhere. */
export function openInMapsUrl(l: { name?: string; address?: string; lat?: number | null; lng?: number | null }): string {
  const q = l.lat != null && l.lng != null ? `${l.lat},${l.lng}` : [l.name, l.address].filter(Boolean).join(', ')
  return isApple() ? `https://maps.apple.com/?q=${enc(q)}` : `https://www.google.com/maps/search/?api=1&query=${enc(q)}`
}
/** The same place as a Google Maps link that works in a PDF or an email. */
export const googleMapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${enc(q)}`

/** Turn a stored Google Maps link into the right one for this device: Apple Maps on Apple touch devices. */
export function platformMapsUrl(googleUrl: string): string {
  if (!googleUrl || !isApple()) return googleUrl
  try { const q = new URL(googleUrl).searchParams.get('query'); return q ? `https://maps.apple.com/?q=${enc(q)}` : googleUrl } catch { return googleUrl }
}

export interface Found { label: string; lat: number; lng: number }
/** Look an address up in OpenStreetMap's search. Called only when a person presses Find, one request each time. */
export async function searchAddress(q: string): Promise<Found[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${enc(q)}`, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error('The address search is not available right now. Try again in a moment, or click the map to place the pin.')
  const rows = (await r.json()) as { display_name: string; lat: string; lon: string }[]
  return rows.map((x) => ({ label: x.display_name, lat: Math.round(Number(x.lat) * 1e6) / 1e6, lng: Math.round(Number(x.lon) * 1e6) / 1e6 }))
}

// ---- photos
export function useLocationUrls(paths: string[]) {
  const key = [...paths].sort().join('|')
  return useQuery({
    queryKey: ['loc-signed', key],
    enabled: paths.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(LOC_BUCKET).createSignedUrls(paths, 3600)
      if (error) throw error
      return new Map(data.map((d) => [d.path ?? '', d.signedUrl ?? '']))
    },
  })
}
export async function uploadLocationPhoto(pid: string, lid: string, blob: Blob): Promise<string> {
  const path = `${pid}/${lid}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(LOC_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}
export async function removeLocationFiles(paths: string[]) {
  if (paths.length) await supabase.storage.from(LOC_BUCKET).remove(paths)
}
/** Delete every file under a folder of the bucket (a project, or one location). */
export async function removeLocationFolder(prefix: string): Promise<void> {
  const { data } = await supabase.storage.from(LOC_BUCKET).list(prefix, { limit: 1000 })
  const files = (data ?? []).filter((x) => x.id).map((x) => `${prefix}/${x.name}`)
  const dirs = (data ?? []).filter((x) => !x.id).map((x) => `${prefix}/${x.name}`)
  if (files.length) await supabase.storage.from(LOC_BUCKET).remove(files)
  for (const d of dirs) await removeLocationFolder(d)
}
