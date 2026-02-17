import { assessRecentCoverageOverlap, isRetryableGenerationError } from './generateArticle'
import { describe, expect, it } from 'vitest'

describe('generateArticle repetition guard helpers', () => {
  it('flags strong overlap for the same premise wording', () => {
    const assessment = assessRecentCoverageOverlap({
      candidate:
        'The mysterious case of disappearing U-Bahn seats: 12 seats vanished overnight and were replaced with yoga mats',
      references: [
        'Twelve U-Bahn Seats Removed Overnight, Replaced With Yoga Mats in a BVG Posture Upgrade',
      ],
    })

    expect(assessment.overlaps).toBe(true)
    expect(assessment.score).toBeGreaterThan(0)
  })

  it('does not flag unrelated stories', () => {
    const assessment = assessRecentCoverageOverlap({
      candidate:
        'Buergeramt launches a lottery for Anmeldung appointments, winners receive stamped forms and free coffee',
      references: [
        'Twelve U-Bahn Seats Removed Overnight, Replaced With Yoga Mats in a BVG Posture Upgrade',
      ],
    })

    expect(assessment.overlaps).toBe(false)
  })

  it('does not flag sparse word-only overlap without sequence/density', () => {
    const assessment = assessRecentCoverageOverlap({
      candidate:
        'alpha bravo charlie delta echo foxtrot golf hotel india juliet cedar maple spruce birch willow poplar aspen alder beech walnut',
      references: [
        'juliet india hotel golf foxtrot echo delta charlie bravo alpha quartz basalt granite marble slate shale pumice obsidian travertine gneiss',
      ],
    })

    expect(assessment.overlaps).toBe(false)
  })

  it('identifies retryable repetition-guard errors', () => {
    expect(isRetryableGenerationError(new Error('REPETITION_GUARD: overlap detected'))).toBe(true)
    expect(isRetryableGenerationError(new Error('different error'))).toBe(false)
  })
})
