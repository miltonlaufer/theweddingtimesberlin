import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  evaluateDraftCandidate: vi.fn(),
  fetchRssTopics: vi.fn(),
  generateArticle: vi.fn(),
  generateAuthors: vi.fn(),
  generateDraftCandidate: vi.fn(),
  getOrComputeBlacklistSummary: vi.fn(),
  getPayload: vi.fn(),
}))

vi.mock('@/lib/payload', () => ({
  getPayload: mocks.getPayload,
}))

vi.mock('@/lib/rss/fetchRssTopics', () => ({
  fetchRssTopics: mocks.fetchRssTopics,
}))

vi.mock('@/lib/generation/generateArticle', () => ({
  extractHeadlinePatterns: () => [],
  generateArticle: mocks.generateArticle,
  isRetryableGenerationError: () => false,
  shouldIncludeHumorPerspectiveMethod: () => false,
  summarizeRecentArticlesForBlacklist: vi.fn(),
}))

vi.mock('@/lib/generation/generateAuthors', () => ({
  generateAuthors: mocks.generateAuthors,
}))

vi.mock('@/lib/generation/blacklistSummaryCache', () => ({
  getOrComputeBlacklistSummary: mocks.getOrComputeBlacklistSummary,
}))

vi.mock('@/lib/generation/draftPipeline', () => ({
  evaluateDraftCandidate: mocks.evaluateDraftCandidate,
  generateDraftCandidate: mocks.generateDraftCandidate,
}))

vi.mock('@/lib/images/generateAndUploadImage', () => ({
  generateAndUploadImage: vi.fn(),
}))

vi.mock('@payloadcms/richtext-lexical', () => ({
  convertMarkdownToLexical: () => ({ root: { children: [] } }),
  defaultEditorConfig: {},
  sanitizeServerEditorConfig: async () => ({}),
}))

const originalEnv = process.env

describe('debug generate-article draft path', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DEBUG_DRAFT_ATTEMPTS: '2',
      MIN_AUTHOR_POOL: '1',
    }
    mocks.evaluateDraftCandidate.mockReset()
    mocks.fetchRssTopics.mockReset()
    mocks.generateArticle.mockReset()
    mocks.generateAuthors.mockReset()
    mocks.generateDraftCandidate.mockReset()
    mocks.getOrComputeBlacklistSummary.mockReset()
    mocks.getPayload.mockReset()

    mocks.fetchRssTopics.mockResolvedValue({ topicSummary: '' })
    mocks.getOrComputeBlacklistSummary.mockResolvedValue({
      summary: '',
      cacheHit: true,
      signature: 'test-signature',
    })
    mocks.getPayload.mockResolvedValue({
      config: {},
      find: vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === 'categories') {
          return {
            docs: [{ id: 1, slug: 'bureaucracy', name: 'Bureaucracy', order: 1 }],
            totalDocs: 1,
          }
        }
        if (collection === 'authors') {
          return {
            docs: [{ id: 2, slug: 'staff-writer', name: 'Staff Writer' }],
            totalDocs: 1,
          }
        }
        return { docs: [], totalDocs: 0 }
      }),
      create: vi.fn(),
    })
    mocks.generateDraftCandidate.mockResolvedValue({
      draft: {
        headline: 'Hospital Queue Turns Patience Into Policy',
        subheadline: 'Les patients attendent pendant que le guichet ferme.',
        excerpt: 'The hospital turns waiting into a branded public service.',
      },
      sourceRssTopic: null,
    })
    mocks.evaluateDraftCandidate.mockResolvedValue({
      accepted: false,
      reason: 'headline-language: the subheadline is not US English',
      repetition: {
        overlaps: false,
        score: 0,
        reason: 'no overlap',
        matchedReference: null,
      },
      tone: {
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        languagePass: false,
        englishShare: 1,
        germanUsageSummary: 'The subheadline is French rather than US English.',
        pass: false,
        reason: 'Supporting text language policy failed.',
      },
    })
    mocks.generateArticle.mockRejectedValue(new Error('article generation must not run'))
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('does not publish a language-rejected draft after attempts are exhausted', async () => {
    const request = new Request(
      'https://example.test/api/debug/generate-article?draftPath&publish=0',
      { method: 'POST' },
    )

    await expect(POST(request)).rejects.toThrow(
      'headline-language: the subheadline is not US English',
    )
    expect(mocks.generateDraftCandidate).toHaveBeenCalledTimes(2)
    expect(mocks.evaluateDraftCandidate).toHaveBeenCalledTimes(2)
    expect(mocks.generateArticle).not.toHaveBeenCalled()
  })
})
