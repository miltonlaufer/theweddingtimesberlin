import { describe, expect, it } from 'vitest'
import { sanitizeInstagramOverlayText } from './createInstagramImage'

describe('sanitizeInstagramOverlayText', () => {
  it('replaces non-standard hyphens with ASCII hyphens', () => {
    const input = 'Pay‑Per–Persecution — short‒term full−service'
    expect(sanitizeInstagramOverlayText(input)).toBe(
      'Pay-Per-Persecution - short-term full-service',
    )
  })

  it('replaces non-breaking spaces and trims extra whitespace', () => {
    const input = '  Wedding\u00A0opens\u202Ftonight \n with  drama  '
    expect(sanitizeInstagramOverlayText(input)).toBe('Wedding opens tonight with drama')
  })
})
