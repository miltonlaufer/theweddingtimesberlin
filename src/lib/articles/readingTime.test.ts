import { describe, expect, it } from 'vitest'
import { calculateReadingTime } from './readingTime'

describe('calculateReadingTime', () => {
  it('returns at least 1 minute for empty content', () => {
    expect(calculateReadingTime('')).toBe(1)
  })

  it('rounds up based on word count', () => {
    const words = Array.from({ length: 400 }).fill('word').join(' ')
    expect(calculateReadingTime(words)).toBe(2)
  })

  it('strips html tags before counting', () => {
    const content = '<p>Hello <strong>world</strong></p>'
    expect(calculateReadingTime(content)).toBe(1)
  })
})
