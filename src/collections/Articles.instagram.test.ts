import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAndUploadInstagramImage: vi.fn(),
  postToInstagram: vi.fn(),
  recordInstagramIntegrationFailure: vi.fn(),
  recordInstagramIntegrationRecovery: vi.fn(),
}))

vi.mock('@/lib/instagram/createInstagramImage', () => ({
  createAndUploadInstagramImage: mocks.createAndUploadInstagramImage,
}))

vi.mock('@/lib/instagram/postToInstagram', () => ({
  postToInstagram: mocks.postToInstagram,
}))

vi.mock('@/lib/instagram/instagramAlerts', () => ({
  recordInstagramIntegrationFailure: mocks.recordInstagramIntegrationFailure,
  recordInstagramIntegrationRecovery: mocks.recordInstagramIntegrationRecovery,
}))

describe('article-hook Instagram publishing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INSTAGRAM_AUTO_POST_ON_ARTICLE_CREATE = 'true'
    mocks.createAndUploadInstagramImage.mockResolvedValue({
      publicUrl: 'https://cdn.example/instagram.png',
    })
  })

  it('records a publishing failure from the alternate automatic path', async () => {
    mocks.postToInstagram.mockResolvedValue({ ok: false, error: 'Token rejected' })
    const { publishArticleToInstagram } = await import('./Articles')

    await publishArticleToInstagram({
      headline: 'Headline',
      slug: 'headline',
      excerpt: 'Excerpt',
      featuredImageUrl: 'https://cdn.example/source.png',
      status: 'published',
    })

    expect(mocks.recordInstagramIntegrationFailure).toHaveBeenCalledWith(
      'publish',
      'Token rejected',
    )
  })

  it('records recovery when the alternate automatic path succeeds', async () => {
    mocks.postToInstagram.mockResolvedValue({ ok: true, mediaId: 'media-1' })
    const { publishArticleToInstagram } = await import('./Articles')

    await publishArticleToInstagram({
      headline: 'Headline',
      slug: 'headline',
      excerpt: 'Excerpt',
      featuredImageUrl: 'https://cdn.example/source.png',
      status: 'published',
    })

    expect(mocks.recordInstagramIntegrationRecovery).toHaveBeenCalledWith('publish')
  })

  it('does not turn a recovery-email error into a publishing failure', async () => {
    mocks.postToInstagram.mockResolvedValue({ ok: true, mediaId: 'media-1' })
    mocks.recordInstagramIntegrationRecovery.mockRejectedValue(new Error('Resend unavailable'))
    const { publishArticleToInstagram } = await import('./Articles')

    await publishArticleToInstagram({
      headline: 'Headline',
      slug: 'headline',
      excerpt: 'Excerpt',
      featuredImageUrl: 'https://cdn.example/source.png',
      status: 'published',
    })

    expect(mocks.recordInstagramIntegrationFailure).not.toHaveBeenCalled()
  })

  it('does not retry a failed alert inside the article hook', async () => {
    mocks.postToInstagram.mockResolvedValue({ ok: false, error: 'Token rejected' })
    mocks.recordInstagramIntegrationFailure.mockRejectedValue(new Error('Resend unavailable'))
    const { publishArticleToInstagram } = await import('./Articles')

    await publishArticleToInstagram({
      headline: 'Headline',
      slug: 'headline',
      excerpt: 'Excerpt',
      featuredImageUrl: 'https://cdn.example/source.png',
      status: 'published',
    })

    expect(mocks.recordInstagramIntegrationFailure).toHaveBeenCalledOnce()
  })

  it('keeps the collection hook alive until automatic publishing finishes', async () => {
    mocks.postToInstagram.mockResolvedValue({ ok: true, mediaId: 'media-1' })
    const { Articles } = await import('./Articles')
    const hook = Articles.hooks?.afterChange?.[0]
    if (typeof hook !== 'function') throw new Error('Article afterChange hook is missing')

    await hook({
      doc: {
        headline: 'Headline',
        slug: 'headline',
        excerpt: 'Excerpt',
        featuredImageUrl: 'https://cdn.example/source.png',
        status: 'published',
      },
      previousDoc: null,
      operation: 'create',
    } as never)

    expect(mocks.postToInstagram).toHaveBeenCalledOnce()
  })
})
