import { describe, expect, it } from 'vitest'
import { agoText, bytesText, supabaseRef } from './usage'

describe('usage helpers', () => {
  it('writes sizes in plain units', () => {
    expect(bytesText(0)).toBe('0 B')
    expect(bytesText(2048)).toBe('2 KB')
    expect(bytesText(1572864)).toBe('1.5 MB')
    expect(bytesText(52428800)).toBe('50 MB')
    expect(bytesText(1610612736)).toBe('1.50 GB')
  })
  it('says how long ago something happened', () => {
    const now = new Date('2026-11-15T12:00:00Z').getTime()
    expect(agoText(null, now)).toBe('never')
    expect(agoText('2026-11-15T01:00:00Z', now)).toBe('today')
    expect(agoText('2026-11-14T01:00:00Z', now)).toBe('yesterday')
    expect(agoText('2026-11-05T12:00:00Z', now)).toBe('10 days ago')
    expect(agoText('2026-07-15T12:00:00Z', now)).toBe('4 months ago')
  })
  it('finds the Supabase project reference', () => {
    expect(supabaseRef('https://abcd1234.supabase.co')).toBe('abcd1234')
    expect(supabaseRef('http://localhost:54321')).toBeNull()
    expect(supabaseRef(undefined)).toBeNull()
  })
})
