import { describe, expect, it } from 'vitest'
import { parseStoredSession, shouldSave } from './offline'

describe('offline copy', () => {
  it('never saves the owner dashboard, the email queue or the create check', () => {
    expect(shouldSave(['usage-overview'])).toBe(false)
    expect(shouldSave(['usage-projects'])).toBe(false)
    expect(shouldSave(['usage-people'])).toBe(false)
    expect(shouldSave(['outbox', 'p1'])).toBe(false)
    expect(shouldSave(['can-create-project', 'u1'])).toBe(false)
  })
  it('saves the project reads, including picture links', () => {
    expect(shouldSave(['my-projects', 'u1'])).toBe(true)
    expect(shouldSave(['scenes', 'p1'])).toBe(true)
    expect(shouldSave(['signed', 'a|b'])).toBe(true)
    expect(shouldSave([{ odd: true }])).toBe(true)
  })
  it('reads a stored session and refuses anything else', () => {
    const s = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1', email: 'x@example.com' } })
    expect(parseStoredSession(s)?.user.id).toBe('u1')
    expect(parseStoredSession(null)).toBeNull()
    expect(parseStoredSession('not json')).toBeNull()
    expect(parseStoredSession(JSON.stringify({ access_token: 'a' }))).toBeNull()
    expect(parseStoredSession(JSON.stringify({ refresh_token: 'r' }))).toBeNull()
  })
})
