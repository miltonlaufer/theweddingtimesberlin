import { describe, expect, it } from 'vitest'
import { planEditorialSlots } from './editorialPlanner'

describe('planEditorialSlots', () => {
  it.each([
    { count: 1, expectedRssSlots: 1 },
    { count: 3, expectedRssSlots: 2 },
    { count: 8, expectedRssSlots: 6 },
  ])(
    'requires 66% of a $count-article batch to use RSS topics, rounded up',
    ({ count, expectedRssSlots }) => {
      const plan = planEditorialSlots({
        count,
        hasRssTopics: true,
        forceOpinionFirst: false,
        recentCoverage: [],
        includeHumorPerspectiveMethod: () => false,
      })

      const rssSlots = plan.slots.filter((slot) => slot.forceRss)

      expect(rssSlots).toHaveLength(expectedRssSlots)
      expect(rssSlots.every((slot) => slot.forceDrugsTechno === false)).toBe(true)
      expect(rssSlots.every((slot) => slot.editorDirection?.includes('current-news'))).toBe(true)
    },
  )

  it('prioritizes the RSS requirement over the optional opinion slot', () => {
    const plan = planEditorialSlots({
      count: 2,
      hasRssTopics: true,
      forceOpinionFirst: true,
      recentCoverage: [],
      includeHumorPerspectiveMethod: () => false,
    })

    expect(plan.slots.filter((slot) => slot.forceRss)).toHaveLength(2)
    expect(plan.slots.filter((slot) => slot.forceOpinion)).toHaveLength(0)
  })

  it('does not force drugs/nightlife when recent coverage is saturated', () => {
    const plan = planEditorialSlots({
      count: 6,
      hasRssTopics: true,
      forceOpinionFirst: false,
      recentCoverage: Array.from({ length: 10 }, (_, index) => ({
        headline: `Ketamine Club Door Policy ${index}`,
        excerpt: 'Dealers, bouncers, techno, and pills.',
        categorySlug: 'nightlife',
      })),
      includeHumorPerspectiveMethod: () => false,
    })

    expect(plan.summary.saturatedThemes).toContain('drugs-nightlife')
    expect(plan.slots.some((slot) => slot.forceDrugsTechno === true)).toBe(false)
  })

  it('adds concrete editor direction for non-RSS undercovered local slots', () => {
    const plan = planEditorialSlots({
      count: 6,
      hasRssTopics: false,
      forceOpinionFirst: false,
      recentCoverage: [],
      includeHumorPerspectiveMethod: () => false,
    })

    expect(plan.slots.some((slot) => slot.editorDirection?.includes('bureaucracy'))).toBe(true)
    expect(plan.slots.some((slot) => slot.editorDirection?.includes('Kiez'))).toBe(true)
  })
})
