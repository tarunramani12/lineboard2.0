import { describe, expect, it } from 'vitest'
import { blockedOn, costTotals, googleMapsUrl, money, openInMapsUrl, totalsText, type LocAvail, type LocCost } from './locations'

const cost = (o: Partial<LocCost>): LocCost => ({ id: 'x', location_id: 'l', project_id: 'p', kind: 'Location fee', amount: 0, currency: 'EUR', quantity: 1, status: 'quoted', due_date: null, paid_date: null, note: '', ...o })
const av = (o: Partial<LocAvail>): LocAvail => ({ id: 'a', location_id: 'l', start_date: '2026-03-01', end_date: '2026-03-03', kind: 'unavailable', day_id: null, note: '', ...o })

describe('cost totals', () => {
  it('multiplies amount by quantity and groups by currency', () => {
    const t = costTotals([cost({ amount: 500, quantity: 2 }), cost({ amount: 100 }), cost({ amount: 50, currency: 'USD' })])
    expect(t.get('EUR')).toBe(1100)
    expect(t.get('USD')).toBe(50)
  })
  it('keeps cents exact', () => {
    expect(costTotals([cost({ amount: 0.1 }), cost({ amount: 0.2 })]).get('EUR')).toBe(0.3)
  })
  it('a No charge line of 0 totals 0', () => {
    expect(costTotals([cost({ kind: 'No charge', amount: 0 })]).get('EUR')).toBe(0)
  })
  it('writes totals as text', () => {
    expect(totalsText(new Map([['EUR', 12]]))).toContain('12')
    expect(money(5, 'ZZZ')).toContain('5.00')
  })
})

describe('availability', () => {
  it('blocks only dates inside a not-available range', () => {
    const rows = [av({}), av({ id: 'b', kind: 'booked', start_date: '2026-03-10', end_date: '2026-03-10' }), av({ id: 'c', kind: 'available', start_date: '2026-03-05', end_date: '2026-03-06' })]
    expect(blockedOn(rows, '2026-03-02')).toHaveLength(1)
    expect(blockedOn(rows, '2026-03-01')).toHaveLength(1)
    expect(blockedOn(rows, '2026-03-03')).toHaveLength(1)
    expect(blockedOn(rows, '2026-03-04')).toHaveLength(0)
    expect(blockedOn(rows, '2026-03-10')).toHaveLength(0)
    expect(blockedOn(rows, '2026-03-05')).toHaveLength(0)
  })
})

describe('map links', () => {
  it('uses coordinates when there is a pin, else the name and address', () => {
    expect(openInMapsUrl({ name: 'Mill', address: 'Mill Rd 1', lat: 48.1, lng: 11.5 })).toContain('48.1%2C11.5')
    expect(openInMapsUrl({ name: 'Mill', address: 'Mill Rd 1' })).toContain('Mill%2C%20Mill%20Rd%201')
  })
  it('makes a Google link for a hospital that works in a PDF', () => {
    expect(googleMapsUrl('St Mary Hospital, Main St')).toBe('https://www.google.com/maps/search/?api=1&query=St%20Mary%20Hospital%2C%20Main%20St')
  })
})

import { buildLocations, diffSnapshots, type SheetSnapshot } from './callsheets'
import { withinForecast } from './weather'
import type { Loc } from './locations'
import type { Scene } from './types'

const loc = (id: string, o: Partial<Loc> = {}): Loc => ({ id, project_id: 'p', name: id, kind: '', int_ext: '', status: 'scouted', address: '', lat: null, lng: null, parking: '', access_restrictions: '', hospital: '', permit_required: false, permit_status: 'none', permit_no: '', agreement_signed: false, notes: '', links: [], locked_at: null, created_at: '', updated_at: '', ...o })
const scene = (id: string) => ({ id, heading: 'INT. X - DAY', display_number: id } as unknown as Scene)

describe('call sheet locations', () => {
  const locs = [loc('mill', { name: 'Old mill', address: 'Mill Rd 1', lat: 48.1, lng: 11.5, hospital: 'St Mary, Main St', parking: 'Yard' }), loc('harbour', { name: 'Harbour' })]
  it('lists first-choice locations of the day, the day location first, with letters', () => {
    const firstOf = new Map([['1', 'harbour'], ['2', 'mill'], ['3', 'harbour']])
    const r = buildLocations([scene('1'), scene('2'), scene('3')], { locs, firstOf, dayLocationId: 'mill' })
    expect(r.locations.map((l) => [l.code, l.id, l.base])).toEqual([['A', 'mill', true], ['B', 'harbour', false]])
    expect(r.locationOfScene.get('1')).toBe('B')
    expect(r.locations[1].scene_ids).toEqual(['1', '3'])
  })
  it('without a day location the first scene decides the base; scenes with no location get no letter', () => {
    const r = buildLocations([scene('1'), scene('2')], { locs, firstOf: new Map([['2', 'harbour']]), dayLocationId: null })
    expect(r.locations).toHaveLength(1)
    expect(r.locations[0].base).toBe(true)
    expect(r.locationOfScene.has('1')).toBe(false)
  })
  it('gives the hospital its own maps link and never includes a contact or cost', () => {
    const [l] = buildLocations([], { locs, firstOf: new Map(), dayLocationId: 'mill' }).locations
    expect(l.hospital_map_url).toContain('St%20Mary')
    expect(l.map_url).toContain('48.1%2C11.5')
    expect(Object.keys(l).some((k) => /contact|phone|email|cost|permit/.test(k))).toBe(false)
  })
  it('one location gives one block and no multiple-location need', () => {
    expect(buildLocations([scene('1')], { locs, firstOf: new Map([['1', 'mill']]), dayLocationId: null }).locations).toHaveLength(1)
  })
})

describe('call sheet changes', () => {
  const base = (locations: SheetSnapshot['locations']): SheetSnapshot => ({ v: 1, project: 'P', schedule: 'S', day_no: 1, day_count: 1, date: '2026-03-02', location: '', general_call: '07:00', hospital: '', notes: '', scenes: [], cast: [], crew: [], locations })
  const l = { id: 'mill', code: 'A', name: 'Old mill', address: 'x', map_url: 'u', parking: 'Yard', access: '', hospital: '', hospital_map_url: '', weather: 'Rain', scene_ids: [], base: true }
  it('marks a location block when its details change', () => {
    expect(diffSnapshots(base([l]), base([{ ...l, parking: 'Street' }])).changed.has('loc:mill')).toBe(true)
  })
  it('does not mark a block when only the forecast changed', () => {
    expect(diffSnapshots(base([l]), base([{ ...l, weather: 'Sunny' }])).changed.size).toBe(0)
  })
  it('marks a block added after the previous revision, and copes with revisions that had none', () => {
    expect(diffSnapshots(base([l]), base([l, { ...l, id: 'b', code: 'B' }])).changed.has('loc:b')).toBe(true)
    expect(diffSnapshots(base(undefined), base([l])).changed.has('loc:mill')).toBe(true)
  })
})

describe('forecast reach', () => {
  const now = new Date('2026-11-14T10:00:00Z')
  it('covers today and about 9 days ahead', () => {
    expect(withinForecast('2026-11-14', now)).toBe(true)
    expect(withinForecast('2026-11-23', now)).toBe(true)
    expect(withinForecast('2026-11-24', now)).toBe(false)
    expect(withinForecast('2026-11-13', now)).toBe(false)
  })
})
