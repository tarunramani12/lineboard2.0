import { describe, expect, it } from 'vitest'
import { senderPreview } from './email'

describe('senderPreview', () => {
  it('uses the chosen id and display name', () => {
    expect(senderPreview({ name: 'Film', mail_id: 'bakery-at-night', mail_name: 'Bakery at Night' })).toBe('Bakery at Night (via LineBoard) <bakery-at-night@lineboard.app>')
  })
  it('falls back to the project name and noreply', () => {
    expect(senderPreview({ name: 'Film', mail_id: null, mail_name: '' })).toBe('Film (via LineBoard) <noreply@lineboard.app>')
  })
  it('removes characters that break an address line', () => {
    expect(senderPreview({ name: 'A <b> "c"', mail_id: null, mail_name: '' })).toBe('A b c (via LineBoard) <noreply@lineboard.app>')
  })
})
