import { describe, expect, it } from 'vitest'
import { normalizeSubheadlineForStorage } from './subheadline'

describe('normalizeSubheadlineForStorage', () => {
  it('keeps clean complete subheadlines', () => {
    const value = 'Club regulars now treat the booth as a confessional with bass.'
    expect(normalizeSubheadlineForStorage(value)).toBe(value)
  })

  it('rejects an overlong sentence instead of dropping its final noun', () => {
    const value =
      'Union Berlin’s standing-room devotion is about to be treated like a scheduling miracle, as Bundesliga bosses discover that the club’s biggest asset is not football but the crowd’s willingness to rearrange its entire schedule.'

    expect(normalizeSubheadlineForStorage(value)).toBe('')
  })

  it('keeps a complete first sentence even when it is far below the limit', () => {
    const value =
      'The league wants Monday matches. Union Berlin’s standing-room devotion is about to be treated like a scheduling miracle, as Bundesliga bosses discover that the club’s biggest asset is not football but the crowd’s willingness to rearrange its entire schedule.'

    expect(normalizeSubheadlineForStorage(value)).toBe('The league wants Monday matches.')
  })

  it('drops a trailing comma fragment instead of storing a cropped list', () => {
    const value =
      'The official nightlife story is that Berlin club culture is about freedom, experimentation, and collective release. The less flattering detail is how many people now treat the DJ as a licensed therapist, private banker,'

    expect(normalizeSubheadlineForStorage(value)).toBe(
      'The official nightlife story is that Berlin club culture is about freedom, experimentation, and collective release.',
    )
  })
})
