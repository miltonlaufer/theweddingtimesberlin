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

function makeRequest(): Request {
  return new Request('https://example.test/api/internal/generation/slot-worker', {
    method: 'POST',
    body: JSON.stringify({
      jobId: 123,
      itemId: 456,
      slot: {
        forceOpinion: false,
        includeTopics: true,
      },
      topicSummary: '- topic',
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
})
