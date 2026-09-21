import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  scheduledAfter: undefined as (() => Promise<void>) | undefined,
  getPayload: vi.fn(),
  tryFinalizeGenerationJob: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: vi.fn((callback: () => Promise<void>) => {
    mocks.scheduledAfter = callback
  }),
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...init?.headers,
        },
      }),
  },
}))

vi.mock('@/lib/payload', () => ({
  getPayload: mocks.getPayload,
}))

vi.mock('@/lib/generation/internalAuth', () => ({
  getInternalCronTokenForCalls: () => 'test-token',
  isInternalCronAuthorized: () => true,
}))

vi.mock('@/lib/generation/runGenerationPipeline', () => ({
  tryFinalizeGenerationJob: mocks.tryFinalizeGenerationJob,
}))

function makeRequest(options?: { forceAfR?: boolean }): Request {
  return new Request('https://example.test/api/internal/generation/slot-worker', {
    method: 'POST',
    body: JSON.stringify({
      jobId: 123,
      itemId: 456,
      slot: {
        forceAfR: options?.forceAfR,
        forceOpinion: false,
        includeTopics: true,
      },
      topicSummary: '- topic',
      rssTopics: [
        {
          source: 'berliner-zeitung',
          title: 'The chancellor faces calls to resign',
          url: 'https://news.example.test/chancellor',
          publishedAt: '2026-09-21T06:00:00.000Z',
          description: 'The report concerns Federal Chancellor Friedrich Merz.',
        },
      ],
      maxDraftAttempts: 3,
    }),
  })
}

describe('slot-worker route', () => {
  beforeEach(() => {
    mocks.scheduledAfter = undefined
    mocks.getPayload.mockReset()
    mocks.tryFinalizeGenerationJob.mockReset()
    mocks.getPayload.mockResolvedValue({
      find: vi.fn().mockResolvedValue({ docs: [] }),
      update: vi.fn().mockResolvedValue({}),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const pathname = new URL(String(url)).pathname
        if (pathname.endsWith('/retry-draft')) {
          return Response.json({
            ok: true,
            accepted: true,
            draft: { headline: 'Accepted draft' },
          })
        }
        if (pathname.endsWith('/process-item')) {
          return Response.json({ ok: true })
        }
        return Response.json({ error: `Unexpected fetch to ${pathname}` }, { status: 500 })
      }),
    )
  })

  it('does not finalize after process-item succeeds because process-item already finalizes', async () => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    expect(mocks.scheduledAfter).toBeDefined()

    await mocks.scheduledAfter?.()

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.tryFinalizeGenerationJob).not.toHaveBeenCalled()
  })

  it('preserves forced AfR mode across draft and article requests', async () => {
    const response = await POST(makeRequest({ forceAfR: true }))
    expect(response.status).toBe(200)

    await mocks.scheduledAfter?.()

    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls
    const requestBodies = fetchCalls.map(([, init]) => JSON.parse(String(init?.body)) as unknown)

    expect(requestBodies).toHaveLength(2)
    for (const body of requestBodies) {
      expect(body).toEqual(
        expect.objectContaining({
          slot: expect.objectContaining({ forceAfR: true }),
        }),
      )
    }
  })

  it('preserves structured RSS source context across draft and article requests', async () => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)

    await mocks.scheduledAfter?.()

    const requestBodies = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)

    expect(requestBodies).toHaveLength(2)
    for (const body of requestBodies) {
      expect(body.rssTopics).toEqual([
        {
          source: 'berliner-zeitung',
          title: 'The chancellor faces calls to resign',
          url: 'https://news.example.test/chancellor',
          publishedAt: '2026-09-21T06:00:00.000Z',
          description: 'The report concerns Federal Chancellor Friedrich Merz.',
        },
      ])
    }
  })

  it('promotes the best safe rejected draft after all retries are exhausted', async () => {
    const update = vi.fn().mockResolvedValue({})
    mocks.getPayload.mockResolvedValue({
      find: vi.fn().mockResolvedValue({ docs: [] }),
      update,
    })
    const retryResponses = [
      {
        ok: true,
        accepted: false,
        exhausted: false,
        draft: {
          headline: 'Safe First Draft',
          subheadline: 'The first safe deck.',
          excerpt: 'The first safe excerpt.',
        },
        sourceRssTopic: 'First topic',
        evaluation: {
          accepted: false,
          safeForFallback: true,
          reason: 'tone: needs more bite',
          repetition: { overlaps: false, score: 0, reason: 'distinct', matchedReference: null },
          tone: {
            funScore: 6,
            mercilessScore: 7,
            specificityScore: 6,
            conceptualInnuendoPass: false,
            metaCommentaryPass: true,
            languagePass: true,
            englishShare: 1,
            germanUsageSummary: 'Deterministic language gate passed.',
            pass: false,
            reason: 'needs more bite',
          },
        },
      },
      {
        ok: true,
        accepted: false,
        exhausted: false,
        draft: {
          headline: 'Unsafe Meta Draft',
          subheadline: 'The second deck.',
          excerpt: 'This piece would satirize the institution.',
        },
        sourceRssTopic: 'Second topic',
        evaluation: {
          accepted: false,
          safeForFallback: false,
          reason: 'tone: meta-commentary',
          repetition: { overlaps: false, score: 0, reason: 'distinct', matchedReference: null },
          tone: {
            funScore: 10,
            mercilessScore: 10,
            specificityScore: 10,
            conceptualInnuendoPass: true,
            metaCommentaryPass: false,
            languagePass: true,
            englishShare: 1,
            germanUsageSummary: 'Deterministic language gate passed.',
            pass: false,
            reason: 'meta-commentary',
          },
        },
      },
      {
        ok: true,
        accepted: false,
        exhausted: true,
        draft: {
          headline: 'Best Safe Draft',
          subheadline: 'The strongest safe deck.',
          excerpt: 'The strongest safe excerpt.',
        },
        sourceRssTopic: 'Third topic',
        evaluation: {
          accepted: false,
          safeForFallback: true,
          reason: 'tone: innuendo could be stronger',
          repetition: { overlaps: false, score: 0, reason: 'distinct', matchedReference: null },
          tone: {
            funScore: 8,
            mercilessScore: 8,
            specificityScore: 7,
            conceptualInnuendoPass: false,
            metaCommentaryPass: true,
            languagePass: true,
            englishShare: 1,
            germanUsageSummary: 'Deterministic language gate passed.',
            pass: false,
            reason: 'innuendo could be stronger',
          },
        },
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const pathname = new URL(String(url)).pathname
        if (pathname.endsWith('/retry-draft')) {
          return Response.json(retryResponses.shift())
        }
        if (pathname.endsWith('/process-item')) {
          return Response.json({ ok: true })
        }
        return Response.json({ error: `Unexpected fetch to ${pathname}` }, { status: 500 })
      }),
    )

    const response = await POST(makeRequest())
    expect(response.status).toBe(200)

    await mocks.scheduledAfter?.()

    expect(update).toHaveBeenCalledWith({
      collection: 'generation-job-items',
      id: 456,
      data: expect.objectContaining({
        status: 'draft-accepted',
        headline: 'Best Safe Draft',
        subheadline: 'The strongest safe deck.',
        excerpt: 'The strongest safe excerpt.',
        sourceRssTopic: 'Third topic',
        error: null,
      }),
    })
    const paths = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([url]) => new URL(String(url)).pathname)
    expect(paths).toEqual([
      '/api/internal/generation/retry-draft',
      '/api/internal/generation/retry-draft',
      '/api/internal/generation/retry-draft',
      '/api/internal/generation/process-item',
    ])
    expect(mocks.tryFinalizeGenerationJob).not.toHaveBeenCalled()
  })
})
