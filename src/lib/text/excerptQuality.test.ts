import { describe, expect, it } from 'vitest'
import {
  hasMetaSummaryVoice,
  hasTerminalExcerptEnding,
  normalizeExcerptForStorage,
} from './excerptQuality'

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

  it('removes dangling dependent clauses created by length trimming', () => {
    const value =
      'The real spectacle in Wedding nightlife is not the dance floor anymore. It is the growing class of chemically confident regulars who drift up to the booth to narrate their breakup, burnout, and brand collapse as if the DJ were obliged to absorb it between tracks — while everyone else quietly.'

    expect(normalizeExcerptForStorage(value, 300)).toBe(
      'The real spectacle in Wedding nightlife is not the dance floor anymore. It is the growing class of chemically confident regulars who drift up to the booth to narrate their breakup, burnout, and brand collapse as if the DJ were obliged to absorb it between tracks.',
    )
  })

  it('rejects meta joke explanations instead of storing them as summaries', () => {
    const value =
      'The joke is not that bureaucracy is slow. It is that clerks have discovered delay as a moral style.'

    expect(hasMetaSummaryVoice(value)).toBe(true)
    expect(normalizeExcerptForStorage(value, 300)).toBe('')
  })

  it('rejects article process framing instead of storing it as a summary', () => {
    const value =
      'This piece follows the sacred chain of blame from ministry to contractor to technical irregularity.'

    expect(hasMetaSummaryVoice(value)).toBe(true)
    expect(normalizeExcerptForStorage(value, 300)).toBe('')
  })

  it('keeps newspaper-style summaries that describe the story directly', () => {
    const value =
      'Wedding clerks turned a noon appointment window into the district’s latest test of patience, paperwork, and civic humiliation.'

    expect(hasMetaSummaryVoice(value)).toBe(false)
    expect(normalizeExcerptForStorage(value, 300)).toBe(value)
  })
})
