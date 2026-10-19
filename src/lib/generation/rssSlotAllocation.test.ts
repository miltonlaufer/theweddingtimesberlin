import { describe, expect, it } from 'vitest'
import type { RssTopic } from '@/lib/rss/fetchRssTopics'
import { deduplicateFreshRssTopics, planEditorialSlotsWithRssAllocation } from './rssSlotAllocation'

function topic(title: string, url = `https://news.example/${title}`): RssTopic {
  return { source: 'nytimes', title, url }
}

const planArgs = { count: 6, forceOpinionFirst: false, recentCoverage: [] }

describe('RSS slot allocation', () => {
  it('deduplicates tracking URL variants and normalized titles before assigning sources', () => {
    const topics = [
      topic('Berlin news!', 'https://news.example/story?id=23&utm_source=rss#feed'),
      topic('Updated headline', 'https://news.example/story?utm_campaign=daily&id=23'),
      topic(' BERLIN NEWS ', 'https://other.example/duplicate'),
      topic('Another story', 'https://news.example/story?id=24'),
    ]
    expect(deduplicateFreshRssTopics(topics)).toEqual([topics[0], topics[3]])
  })

  it('preserves meaningful query values and case-sensitive article paths', () => {
    const topics = [
      topic('First', 'https://news.example/Story?id=A'),
      topic('Second', 'https://news.example/story?id=A'),
      topic('Third', 'https://news.example/Story?id=a'),
    ]
    expect(deduplicateFreshRssTopics(topics)).toEqual(topics)
  })

  it('locks every alias of a recently used title, even when the alias appears first', () => {
    const topics = [
      topic('Updated headline', 'https://news.example/story?id=23'),
      topic('Used headline!', 'https://news.example/story?id=23&utm_source=rss'),
      topic('Unrelated story'),
    ]
    expect(deduplicateFreshRssTopics(topics, new Set(['used headline']))).toEqual([topics[2]])
  })

  it.each([0, 1, 2, 3])(
    'preserves six slots when only %i unique RSS sources are available',
    (count) => {
      const topics = Array.from({ length: count }, (_, index) => topic(`News ${index}`))
      const plan = planEditorialSlotsWithRssAllocation({ ...planArgs, rssTopics: topics })

      expect(plan.slots).toHaveLength(6)
      expect(plan.slots.filter((slot) => slot.forceRss)).toHaveLength(count)
      expect(plan.slots.filter((slot) => !slot.forceRss)).toHaveLength(6 - count)
      for (const slot of plan.slots) {
        if (slot.forceRss) {
          expect(slot.assignedRssTopics).toHaveLength(1)
          expect(slot.assignedRssTopicSummary).toContain(slot.assignedRssTopics[0]!.title)
        } else {
          expect(slot.assignedRssTopics).toEqual([])
          expect(slot.assignedRssTopicSummary).toBe('')
        }
      }
    },
  )

  it('gives concurrent workers disjoint retry pools and summaries in ranked order', async () => {
    const topics = Array.from({ length: 12 }, (_, index) => topic(`Ranked news ${index}`))
    const plan = planEditorialSlotsWithRssAllocation({ ...planArgs, rssTopics: topics })
    const rssSlots = plan.slots.filter((slot) => slot.forceRss)
    expect(rssSlots).toHaveLength(4)
    expect(rssSlots.map((slot) => slot.assignedRssTopics[0]!.title)).toEqual([
      'Ranked news 0',
      'Ranked news 1',
      'Ranked news 2',
      'Ranked news 3',
    ])

    const attemptedSources = await Promise.all(
      rssSlots.map(async (slot) => {
        // A worker may exhaust every candidate through draft and article retries.
        await Promise.resolve()
        expect(slot.assignedRssTopicSummary.split('\n')).toHaveLength(3)
        return slot.assignedRssTopics.map((candidate) => candidate.url)
      }),
    )
    const allAttempts = attemptedSources.flat()
    expect(allAttempts).toHaveLength(12)
    expect(new Set(allAttempts).size).toBe(12)
  })

  it('caps RSS slots by distinct sources rather than raw feed entry count', () => {
    const plan = planEditorialSlotsWithRssAllocation({
      ...planArgs,
      rssTopics: [topic('News'), topic('News', 'https://duplicate.example')],
    })
    expect(plan.slots).toHaveLength(6)
    expect(plan.slots.filter((slot) => slot.forceRss)).toHaveLength(1)
  })
})
