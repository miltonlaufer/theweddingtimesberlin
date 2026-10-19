import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RssTopic } from '@/lib/rss/fetchRssTopics'

const state = vi.hoisted(() => ({
  topics: [] as RssTopic[],
  items: [] as Array<Record<string, unknown>>,
  metadata: {} as Record<string, unknown>,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/payload', () => ({
  getPayload: async () => ({
    find: async ({ collection }: { collection: string }) => {
      const docs =
        collection === 'categories'
          ? [{ id: 'kiez', slug: 'kiez', name: 'Kiez' }]
          : collection === 'authors'
            ? Array.from({ length: 8 }, (_, index) => ({
                id: index + 1,
                slug: `author-${index}`,
                name: `Author ${index}`,
              }))
            : collection === 'generation-job-items'
              ? state.items
              : []
      return { docs, totalDocs: docs.length }
    },
    create: async ({ collection, data }: { collection: string; data: Record<string, unknown> }) => {
      if (collection !== 'generation-job-items') throw new Error(`Unexpected create ${collection}`)
      const item = { id: state.items.length + 1, ...data }
      state.items.push(item)
      return item
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      if (data.metadata) state.metadata = data.metadata as Record<string, unknown>
      return { id: 'job', ...data }
    },
    findByID: async () => ({ id: 'job', status: 'generating', metadata: state.metadata }),
    delete: async () => {
      throw new Error('Unexpected existing item')
    },
  }),
}))
vi.mock('@/lib/rss/fetchRssTopics', () => ({
  fetchRssTopics: async () => ({ topics: state.topics, topicSummary: '' }),
}))
vi.mock('@/lib/generation/generateArticle', () => ({
  extractHeadlinePatterns: () => [],
  rankRssTopicsForHumor: async () => [0, 0, 1], // Duplicate/partial model ranking must not destroy capacity.
  shouldIncludeHumorPerspectiveMethod: () => false,
  summarizeRecentArticlesForBlacklist: async () => '',
}))
vi.mock('@/lib/generation/blacklistSummaryCache', () => ({
  getOrComputeBlacklistSummary: async () => ({ summary: '', cacheHit: true, signature: 'test' }),
}))
vi.mock('@/lib/generation/generateAuthors', () => ({ generateAuthors: async () => [] }))
vi.mock('@/lib/push/sendNotifications', () => ({ sendPushNotifications: vi.fn() }))
vi.mock('@/lib/generation/refineDraftInnuendo', () => ({ summarizeBatchDraftInnuendo: vi.fn() }))

describe('generation pipeline RSS worker dispatch', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('ARTICLES_PER_RUN', '6')
    state.items = []
    state.metadata = {}
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([1, 12])(
    'dispatches six workers with exclusive source pools from %i candidates',
    async (sourceCount) => {
      state.topics = Array.from({ length: sourceCount }, (_, index) => ({
        source: 'nytimes',
        title: `News ${index}`,
        url: `https://news.example/${index}`,
      }))
      const dispatched: Array<{
        rssTopics: RssTopic[]
        topicSummary: string
        slot: { forceRss?: boolean }
      }> = []
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        dispatched.push(JSON.parse(String(init.body)))
        return { ok: true, status: 200, json: async () => ({ ok: true, queued: true }) }
      })
      const { runGenerationPipeline } = await import('./runGenerationPipeline')
      await runGenerationPipeline({
        baseUrl: 'https://test.example',
        tokenForInternalCalls: 'test',
        jobId: 'job',
      })

      expect(dispatched).toHaveLength(6)
      expect(dispatched.filter((request) => request.slot.forceRss)).toHaveLength(
        sourceCount === 1 ? 1 : 4,
      )
      const assignedUrls = dispatched.flatMap((request) =>
        request.rssTopics.map((topic) => topic.url),
      )
      expect(assignedUrls).toHaveLength(sourceCount)
      expect(new Set(assignedUrls).size).toBe(sourceCount)
      for (const [index, request] of dispatched.entries()) {
        const savedSlot = state.items[index]!.slotConfig as {
          assignedRssTopics: RssTopic[]
          assignedRssTopicSummary: string
        }
        expect(request.rssTopics).toEqual(savedSlot.assignedRssTopics)
        expect(request.topicSummary).toBe(savedSlot.assignedRssTopicSummary)
        if (!request.slot.forceRss) {
          expect(request.rssTopics).toEqual([])
          expect(request.topicSummary).toBe('')
        }
      }
    },
  )
})
