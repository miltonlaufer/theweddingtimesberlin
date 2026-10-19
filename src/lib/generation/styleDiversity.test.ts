import { describe, expect, it } from 'vitest'
import { assessStyleDiversity, buildBatchStyleDirections } from './styleDiversity'

const draft = (headline: string, excerpt = '') => ({ headline, subheadline: null, excerpt })

describe('style diversity', () => {
  it('flags foreplay reused across different news topics rather than treating them as fresh innuendo', () => {
    const result = assessStyleDiversity({
      candidate: draft('Charité Demands Better Foreplay'),
      recentCoverage: [
        draft('Rubio’s Silk Road Foreplay'),
        draft('Discovery Without the Foreplay'),
      ],
      acceptedDrafts: [],
    })
    expect(result.pass).toBe(false)
    expect(result.signals).toContain('sexual-trope:foreplay')
  })

  it('counts a trope once per reference article even when repeated in headline and excerpt', () => {
    expect(
      assessStyleDiversity({
        candidate: draft('The Foreplay Committee'),
        recentCoverage: [draft('One Foreplay Story', 'More foreplay.')],
        acceptedDrafts: [],
      }).pass,
    ).toBe(true)
  })

  it('spots the same trope in a current-batch excerpt', () => {
    expect(
      assessStyleDiversity({
        candidate: draft('Doctors Await Satisfaction', 'The strike is foreplay.'),
        recentCoverage: [],
        acceptedDrafts: [draft('Discovery Without the Foreplay')],
      }).pass,
    ).toBe(false)
  })

  it.each([
    'Hamlet in the Bürgeramt: Waiting for Approval',
    'Kafka at the Späti',
    'Sisyphus im Spielplatz',
  ])('flags the decorative character-in-a-place scaffold: %s', (headline) => {
    expect(
      assessStyleDiversity({ candidate: draft(headline), recentCoverage: [], acceptedDrafts: [] })
        .signals,
    ).toContain('cultural-placement-template')
  })

  it('allows cultural references that perform an action and literal news subjects at a venue', () => {
    for (const headline of [
      'Hamlet Demands a Second Opinion',
      'Doctors in the Hospital Demand Higher Pay',
      'Marteria Keeps Europe Open for One More Night',
    ]) {
      expect(
        assessStyleDiversity({ candidate: draft(headline), recentCoverage: [], acceptedDrafts: [] })
          .pass,
      ).toBe(true)
    }
  })

  it('does not allow swapping to another saturated sexual trope', () => {
    expect(
      assessStyleDiversity({
        candidate: draft('The Office Demands Submission'),
        recentCoverage: [
          draft('The Ministry Demands Submission'),
          draft('Applicants Learn to Submit'),
        ],
        acceptedDrafts: [],
      }).signals,
    ).toContain('sexual-trope:submission')
  })

  it('gives all six slots distinct mechanisms and prioritizes less-used ones', () => {
    const directions = buildBatchStyleDirections(6, [
      draft('Long Foreplay'),
      draft('More Foreplay'),
    ])
    expect(new Set(directions).size).toBe(6)
    expect(directions.every(Boolean)).toBe(true)
    expect(directions[0]).not.toContain('seduction and withholding')
  })
})
