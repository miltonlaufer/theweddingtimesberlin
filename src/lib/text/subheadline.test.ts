import { describe, expect, it } from 'vitest'
import { normalizeSubheadlineForStorage } from './subheadline'

describe('normalizeSubheadlineForStorage', () => {
  it('keeps clean complete subheadlines', () => {
    const value = 'Club regulars now treat the booth as a confessional with bass.'
    expect(normalizeSubheadlineForStorage(value)).toBe(value)
  })

  it('drops a trailing comma fragment instead of storing a cropped list', () => {
    const value =
      'The official nightlife story is that Berlin club culture is about freedom, experimentation, and collective release. The less flattering detail is how many people now treat the DJ as a licensed therapist, private banker,'

    expect(normalizeSubheadlineForStorage(value)).toBe(
      'The official nightlife story is that Berlin club culture is about freedom, experimentation, and collective release.',
    )
  })
})
