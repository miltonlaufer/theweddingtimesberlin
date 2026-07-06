import { describe, expect, it } from 'vitest'
import { planEditorialSlots } from './editorialPlanner'

describe('planEditorialSlots', () => {
  it('guarantees RSS slots without forcing them into drugs/nightlife', () => {
    const plan = planEditorialSlots({
      count: 6,
      hasRssTopics: true,
      forceOpinionFirst: false,
      recentCoverage: [],
      includeHumorPerspectiveMethod: () => false,
    })

    const rssSlots = plan.slots.filter((slot) => slot.forceRss)

    expect(rssSlots).toHaveLength(2)
    expect(rssSlots.every((slot) => slot.forceDrugsTechno === false)).toBe(true)
    expect(rssSlots.every((slot) => slot.editorDirection?.includes('current-news'))).toBe(true)
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
