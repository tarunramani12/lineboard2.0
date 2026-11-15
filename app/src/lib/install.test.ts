import { describe, expect, it } from 'vitest'
import { installKind, isIosDevice, isSnoozed } from './install'

describe('install hint', () => {
  it('recognises iPhone, iPad and an iPad that reports itself as a Mac', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5)).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 5)).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false)
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5)).toBe(false)
  })
  it('snoozes until the stored time', () => {
    expect(isSnoozed(null, 1000)).toBe(false)
    expect(isSnoozed('abc', 1000)).toBe(false)
    expect(isSnoozed('2000', 1000)).toBe(true)
    expect(isSnoozed('500', 1000)).toBe(false)
  })
  it('chooses what to show', () => {
    const base = { standalone: false, snoozed: false, hasPrompt: false, ios: false }
    expect(installKind(base)).toBeNull()
    expect(installKind({ ...base, hasPrompt: true })).toBe('prompt')
    expect(installKind({ ...base, ios: true })).toBe('ios')
    expect(installKind({ ...base, hasPrompt: true, ios: true })).toBe('prompt')
    expect(installKind({ ...base, hasPrompt: true, standalone: true })).toBeNull()
    expect(installKind({ ...base, ios: true, snoozed: true })).toBeNull()
  })
})
