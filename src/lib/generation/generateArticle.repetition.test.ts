import {
  assessRecentCoverageOverlap,
  buildArticlePrimaryCheck,
  isRetryableGenerationError,
  shouldIncludeHumorPerspectiveMethod,
} from './generateArticle'
import { buildDraftPerspectiveRuleLines } from './draftPipeline'
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

  it('flags repeated micro-detail formula even when nouns change', () => {
    const assessment = assessRecentCoverageOverlap({
      candidate:
        'The 4-mm notch that turns Wedding bus shelters into a loyalty funnel for landlords',
      references: [
        'The 7-mm Vent Letting Wedding Clubs Call Themselves Quiet — tiny acoustic cheat code tuned to municipal meters',
        "The 5-mm Scallop That Turns Wedding's Free Phone Chargers into a 1.50 Rental — a carved crescent behind every flap",
        "Peel Here, Profit There: Wedding's Community Compost Bins Have a Tiny Brass Slot That Sells Your Scraps",
      ],
    })

    expect(assessment.overlaps).toBe(true)
    expect(assessment.reason).toContain('formulaRepeat=micro-detail-hook')
  })

  it('does not flag a different civic-premise story just because recent stories used micro-detail formula', () => {
    const assessment = assessRecentCoverageOverlap({
      candidate:
        'District clerks begin swapping queue numbers at random, calling it participatory administration',
      references: [
        'The 7-mm Vent Letting Wedding Clubs Call Themselves Quiet — tiny acoustic cheat code tuned to municipal meters',
        "The 5-mm Scallop That Turns Wedding's Free Phone Chargers into a 1.50 Rental — a carved crescent behind every flap",
        "Peel Here, Profit There: Wedding's Community Compost Bins Have a Tiny Brass Slot That Sells Your Scraps",
      ],
    })

    expect(assessment.overlaps).toBe(false)
  })

  it('identifies retryable repetition-guard errors', () => {
    expect(isRetryableGenerationError(new Error('REPETITION_GUARD: overlap detected'))).toBe(true)
    expect(isRetryableGenerationError(new Error('different error'))).toBe(false)
  })

  it('uses an explicit slot-level humor perspective decision when provided', () => {
    expect(shouldIncludeHumorPerspectiveMethod(true, () => 0.99)).toBe(true)
    expect(shouldIncludeHumorPerspectiveMethod(false, () => 0)).toBe(false)
    expect(shouldIncludeHumorPerspectiveMethod(undefined, () => 0.099)).toBe(true)
    expect(shouldIncludeHumorPerspectiveMethod(undefined, () => 0.1)).toBe(false)
  })

  it('does not leak the under-noticed-detail rule when the humor engine is off', () => {
    expect(buildArticlePrimaryCheck(false)).not.toContain('under-noticed detail')
    expect(buildArticlePrimaryCheck(false)).not.toContain('flips the official narrative')
    expect(buildDraftPerspectiveRuleLines(false).join('\n')).not.toContain('under-noticed detail')
    expect(buildDraftPerspectiveRuleLines(false).join('\n')).not.toContain(
      'opposite of the official narrative',
    )
  })
})
