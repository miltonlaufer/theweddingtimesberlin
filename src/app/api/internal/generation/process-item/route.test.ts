import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
  generateAndUploadImage: vi.fn(),
  generateArticle: vi.fn(),
  createAndUploadInstagramImage: vi.fn(),
  postToInstagram: vi.fn(),
  tryFinalizeGenerationJob: vi.fn(),
  callOrder: [] as string[],
}))

vi.mock('@/lib/payload', () => ({
  getPayload: mocks.getPayload,
}))

vi.mock('@/lib/images/generateAndUploadImage', () => ({
  generateAndUploadImage: mocks.generateAndUploadImage,
}))

vi.mock('@/lib/generation/generateArticle', () => ({
  generateArticle: mocks.generateArticle,
  isRetryableGenerationError: () => false,
}))

vi.mock('@/lib/generation/internalAuth', () => ({
  getInternalCronTokenForCalls: () => 'test-token',
  isInternalCronAuthorized: () => true,
}))

vi.mock('@/lib/generation/draftPipeline', () => ({
  evaluateDraftCandidate: vi.fn(),
  generateDraftCandidate: vi.fn(),
}))

vi.mock('@/lib/generation/runGenerationPipeline', () => ({
  tryFinalizeGenerationJob: mocks.tryFinalizeGenerationJob,
}))

vi.mock('@/lib/instagram/createInstagramImage', () => ({
  createAndUploadInstagramImage: mocks.createAndUploadInstagramImage,
}))

vi.mock('@/lib/instagram/postToInstagram', () => ({
  postToInstagram: mocks.postToInstagram,
}))

vi.mock('@payloadcms/richtext-lexical', () => ({
  convertMarkdownToLexical: () => ({ root: { children: [] } }),
  defaultEditorConfig: {},
  sanitizeServerEditorConfig: async () => ({}),
}))

function makeRequest(options?: { forceAfR?: boolean }): Request {
  return new Request('https://example.test/api/internal/generation/process-item', {
    method: 'POST',
    body: JSON.stringify({
      jobId: 258,
      itemId: 609,
      slot: {
        forceAfR: options?.forceAfR,
        forceOpinion: false,
        includeTopics: true,
      },
      topicSummary: '- topic',
      recentArticleTitles: [],
      recentArticleExcerpts: [],
      recentCanonicalStoryReferences: [],
      precomputedBlacklistSummary: '',
      recentHeadlinePatterns: [],
      publish: true,
      setAsHeadline: false,
    }),
  })
}

describe('process-item route', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CRON_AUTO_PUBLISH_INSTAGRAM: 'true',
      INSTAGRAM_ENABLED: 'true',
      INSTAGRAM_IG_USER_ID: 'ig-user',
      INSTAGRAM_AUTO_POST_ON_ARTICLE_CREATE: 'false',
    }
    mocks.callOrder.length = 0
    mocks.getPayload.mockReset()
    mocks.generateAndUploadImage.mockReset()
    mocks.generateArticle.mockReset()
    mocks.createAndUploadInstagramImage.mockReset()
    mocks.postToInstagram.mockReset()
    mocks.tryFinalizeGenerationJob.mockReset()

    mocks.generateAndUploadImage.mockResolvedValue({ publicUrl: 'https://cdn.example/image.png' })
    mocks.createAndUploadInstagramImage.mockResolvedValue({
      publicUrl: 'https://cdn.example/instagram.png',
    })
    mocks.postToInstagram.mockImplementation(async () => {
      mocks.callOrder.push('instagram-post')
      return { ok: true }
    })
    mocks.tryFinalizeGenerationJob.mockResolvedValue({ finalized: false, pending: true })
    mocks.generateArticle.mockResolvedValue({
      article: {
        headline: 'Siri, Why Is the Courtyard Locked?',
        subheadline: 'Courtyard access now requires emotional paperwork.',
        slug: 'ignored',
        bodyMarkdown: 'Body text',
        excerpt: 'Courtyard access now requires emotional paperwork.',
        categorySlug: 'kiez',
        authorSlug: 'alex-author',
        newAuthorName: null,
        newAuthorTitle: null,
        newAuthorBio: null,
        imagePrompt: 'A courtyard gate',
        imageCaption: 'A locked courtyard.',
        isFeatured: false,
        isHeadline: false,
        layout: 'standard',
        canonicalSourceAuthor: null,
        canonicalSourceStory: null,
      },
      usedRssTopic: null,
    })

    const payload = {
      config: {},
      findByID: vi.fn().mockResolvedValue({
        id: 609,
        job: 258,
        status: 'draft-accepted',
        headline: 'Siri, Why Is the Courtyard Locked?',
        subheadline: 'Courtyard access now requires emotional paperwork.',
        excerpt: 'Courtyard access now requires emotional paperwork.',
      }),
      find: vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === 'categories') {
          return { docs: [{ id: 1, slug: 'kiez', name: 'Kiez', order: 1 }] }
        }
        if (collection === 'authors') {
          return { docs: [{ id: 2, slug: 'alex-author', name: 'Alex Author' }] }
        }
        if (collection === 'articles') {
          return { docs: [] }
        }
        return { docs: [] }
      }),
      create: vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === 'articles') {
          return { id: 1100 }
        }
        return { id: 1 }
      }),
      update: vi.fn(
        async ({ collection, data }: { collection: string; data: { status?: string } }) => {
          if (collection === 'articles') {
            mocks.callOrder.push('article-image-updated')
          }
          if (collection === 'generation-job-items' && data.status === 'completed') {
            mocks.callOrder.push('item-completed')
          }
          return {}
        },
      ),
    }

    mocks.getPayload.mockResolvedValue(payload)
  })

  it('marks the item completed before posting to Instagram', async () => {
    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    expect(mocks.callOrder).toContain('item-completed')
    expect(mocks.callOrder).toContain('instagram-post')
    expect(mocks.callOrder.indexOf('item-completed')).toBeLessThan(
      mocks.callOrder.indexOf('instagram-post'),
    )
  })

  it('passes forced AfR mode into full-article generation', async () => {
    const response = await POST(makeRequest({ forceAfR: true }))

    expect(response.status).toBe(200)
    expect(mocks.generateArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        forceAfR: true,
      }),
    )
  })
})
