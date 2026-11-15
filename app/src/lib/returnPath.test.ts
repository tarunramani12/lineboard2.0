import { describe, expect, it } from 'vitest'
import { signInReturnPath } from './returnPath'

describe('signInReturnPath', () => {
  it('sends a sign-in that started on Account settings to the home page', () => {
    expect(signInReturnPath('/settings')).toBe('/')
    expect(signInReturnPath('/settings', '?x=1')).toBe('/')
  })
  it('still remembers other pages, with their query', () => {
    expect(signInReturnPath('/p/abc/shots')).toBe('/p/abc/shots')
    expect(signInReturnPath('/join', '?code=XYZ')).toBe('/join?code=XYZ')
    expect(signInReturnPath('/')).toBe('/')
    expect(signInReturnPath('/usage')).toBe('/usage')
  })
})
