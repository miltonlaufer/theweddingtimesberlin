import { describe, expect, it } from 'vitest'
import { hasTerminalExcerptEnding, normalizeExcerptForStorage } from './excerptQuality'

describe('normalizeExcerptForStorage', () => {
  it('keeps valid terminal punctuation', () => {
    const value = 'Wedding startups now rent benches by the quarter.'
    expect(normalizeExcerptForStorage(value, 300)).toBe(value)
  })

  it('removes trailing connector fragments and closes sentence', () => {
    const value =
      'Inspired by a summit, Wedding negotiates parking sovereignty with rotating potted plants and the'
    const normalized = normalizeExcerptForStorage(value, 300)
    expect(normalized.endsWith('.')).toBe(true)
    expect(normalized.includes(' and the')).toBe(false)
  })

  it('trims ellipsis endings into a complete sentence', () => {
    const value =
      'Landlords now demand AI certificates for oat milk and hairdressers run express modules because the holo badge...'
    const normalized = normalizeExcerptForStorage(value, 300)
    expect(normalized.endsWith('...')).toBe(false)
    expect(hasTerminalExcerptEnding(normalized)).toBe(true)
  })

  it('stays at or below max length', () => {
    const value = `${'a'.repeat(299)}z`
    const normalized = normalizeExcerptForStorage(value, 300)
    expect(normalized.length).toBeLessThanOrEqual(300)
  })
})
