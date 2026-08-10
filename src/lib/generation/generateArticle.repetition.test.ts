import {
  assessLockedDraftCoherence,
  assessHeadlineSimilarity,
  assessHeadlineTaste,
  assessRecentCoverageOverlap,
  buildArticlePrimaryCheck,
  isRetryableGenerationError,
  shouldIncludeHumorPerspectiveMethod,
} from './generateArticle'
import { buildDraftPerspectiveRuleLines, evaluateDraftCandidate } from './draftPipeline'
import { assertHeadlineLanguagePolicy } from './headlineLanguage'
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

  it('treats a locked-headline language guard failure as retryable', () => {
    let caught: unknown
    try {
      assertHeadlineLanguagePolicy('Du Arschloch, jetzt bitte mit Applaus')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(isRetryableGenerationError(caught)).toBe(true)
  })

  it('allows a repeated word when the full title is not too similar', () => {
    const assessment = assessHeadlineSimilarity({
      candidate: "Wedding's Last Honest Späti Files a Noise Complaint Against Its Own Fridge",
      recentTitles: ['Wedding’s Cemeteries Are Now Premium Lifestyle Real Estate'],
    })

    expect(assessment.tooSimilar).toBe(false)
  })

  it('rejects locked-draft candidates that are too similar to recent headlines', async () => {
    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Wedding’s Kindergartens Have Become the City’s Softest Status Ritual',
        subheadline: null,
        excerpt: 'Daycare panic becomes the district’s cleanest status ritual.',
      },
      recentCoverage: [
        {
          headline: 'Wedding’s Cemeteries Have Become the City’s Quietest Status Ritual',
          excerpt: '',
        },
        {
          headline: "Wedding's Cafes Have Become the City's Most Expensive Waiting Rooms",
          excerpt: '',
        },
      ],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('title-similarity')
  })

  it('rejects titles that join a saturated repeated title fingerprint', () => {
    const assessment = assessHeadlineSimilarity({
      candidate: "Wedding's Recycling Bins Demand Proof of Emotional Composting",
      recentTitles: [
        "Wedding's Cemeteries Have Become the City's Quietest Status Ritual",
        "Wedding's Cafes Have Become the City's Most Expensive Waiting Rooms",
        "Wedding's Bike Lanes Have Become the City's Narrowest Therapy Session",
        "Wedding's Playgrounds Have Become the City's Softest Networking Event",
        "Wedding's Laundromats Have Become the City's Dampest Founder Meetup",
      ],
    })

    expect(assessment.tooSimilar).toBe(true)
    expect(assessment.reason).toContain('title-similarity')
  })

  it('rejects stale explainer headline formulas', () => {
    const assessment = assessHeadlineTaste(
      'Wedding’s Free Tree Giveaway Has Become a Loyalty Test for Residents the District Forgot',
    )

    expect(assessment.passes).toBe(false)
    expect(assessment.reason).toContain('headline-taste')
    expect(assessment.signals).toContain('has-become')
  })

  it('rejects attributed quote headline formulas', () => {
    const assessment = assessHeadlineTaste('‘Bring Your Own Proof,’ Says the Office Window')

    expect(assessment.passes).toBe(false)
    expect(assessment.signals).toContain('quote-attribution')
  })

  it('rejects attributed quote headlines without a comma', () => {
    const assessment = assessHeadlineTaste('‘Please Remove Your Shoes’ Says the Mosque')

    expect(assessment.passes).toBe(false)
    expect(assessment.signals).toContain('quote-attribution')
  })

  it('accepts standalone quote headlines', () => {
    const assessment = assessHeadlineTaste('“Everything Is Fine”')

    expect(assessment.passes).toBe(true)
  })

  it('accepts stranger short headline shapes', () => {
    const assessment = assessHeadlineTaste('The Trees Have Started Taking Names')

    expect(assessment.passes).toBe(true)
  })

  it('rejects locked draft body/image drift', () => {
    const assessment = assessLockedDraftCoherence({
      seedDraft: {
        headline: 'Do Not Feed the Artists, Says the Museum',
        subheadline:
          'A museum access policy turns culture into a feeding schedule for patrons with clean shoes.',
        excerpt: 'Artists are being treated as an exhibit that must stay hungry enough to perform.',
      },
      generatedText:
        'At Gesundbrunnen, Deutsche Bahn passengers watched another delayed train disappear from the board while a transport spokesperson discussed resilience and infrastructure investment.',
    })

    expect(assessment.passes).toBe(false)
    expect(assessment.missingTokens).toContain('artists')
    expect(assessment.missingTokens).toContain('museum')
  })

  it('accepts locked draft body/image continuity', () => {
    const assessment = assessLockedDraftCoherence({
      seedDraft: {
        headline: 'Do Not Feed the Artists, Says the Museum',
        subheadline:
          'A museum access policy turns culture into a feeding schedule for patrons with clean shoes.',
        excerpt: 'Artists are being treated as an exhibit that must stay hungry enough to perform.',
      },
      generatedText:
        'The museum introduced a new feeding schedule for artists after patrons complained that culture felt too alive. Curators said the exhibit works best when artists remain visible, hungry, and close enough to the donors to flatter them.',
    })

    expect(assessment.passes).toBe(true)
    expect(assessment.overlapTokens).toEqual(
      expect.arrayContaining(['museum', 'artists', 'feeding']),
    )
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
