import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  scheduledAfter: undefined as (() => Promise<void>) | undefined,
  runGenerationPipeline: vi.fn(),
  maintainInstagramAccessToken: vi.fn(),
  recordInstagramIntegrationFailure: vi.fn(),
  recordInstagramIntegrationRecovery: vi.fn(),
  events: [] as string[],
}))

vi.mock('next/server', () => ({
  after: vi.fn((callback: () => Promise<void>) => {
    mocks.scheduledAfter = callback
  }),
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      }),
  },
}))

vi.mock('@/lib/generation/internalAuth', () => ({
  getInternalCronTokenForCalls: () => 'test-token',
  isInternalCronAuthorized: () => true,
}))

vi.mock('@/lib/generation/runGenerationPipeline', () => ({
  runGenerationPipeline: mocks.runGenerationPipeline,
}))

vi.mock('@/lib/instagram/instagramTokenStore', () => ({
  maintainInstagramAccessToken: mocks.maintainInstagramAccessToken,
}))

vi.mock('@/lib/instagram/instagramAlerts', () => ({
  recordInstagramIntegrationFailure: mocks.recordInstagramIntegrationFailure,
  recordInstagramIntegrationRecovery: mocks.recordInstagramIntegrationRecovery,
}))

describe('run-job route Instagram maintenance', () => {
  beforeEach(() => {
    process.env.INSTAGRAM_ENABLED = 'true'
    mocks.scheduledAfter = undefined
    mocks.events.length = 0
    mocks.runGenerationPipeline.mockReset()
    mocks.maintainInstagramAccessToken.mockReset()
    mocks.recordInstagramIntegrationFailure.mockReset()
    mocks.recordInstagramIntegrationRecovery.mockReset()

    mocks.maintainInstagramAccessToken.mockImplementation(async () => {
      mocks.events.push('token-maintenance')
      return { ok: true, action: 'refreshed' }
    })
    mocks.recordInstagramIntegrationRecovery.mockImplementation(async () => {
      mocks.events.push('refresh-recovery')
      return { sent: false, deduplicated: true }
    })
    mocks.runGenerationPipeline.mockImplementation(async () => {
      mocks.events.push('generation-pipeline')
    })
  })

  it('maintains the Instagram token before starting article generation', async () => {
    const request = new Request('https://example.test/api/internal/generation/run-job', {
      method: 'POST',
      body: JSON.stringify({ jobId: 123 }),
    })

    const response = await POST(request)
    await mocks.scheduledAfter?.()

    expect(response.status).toBe(200)
    expect(mocks.events).toEqual(['token-maintenance', 'refresh-recovery', 'generation-pipeline'])
  })

  it('alerts on token maintenance failure without blocking article generation', async () => {
    mocks.maintainInstagramAccessToken.mockImplementation(async () => {
      mocks.events.push('token-maintenance')
      return { ok: false, action: 'failed', error: 'Refresh rejected' }
    })
    mocks.recordInstagramIntegrationFailure.mockImplementation(async (_kind, error) => {
      mocks.events.push(`refresh-alert:${String(error)}`)
      return { sent: true, deduplicated: false }
    })
    const request = new Request('https://example.test/api/internal/generation/run-job', {
      method: 'POST',
      body: JSON.stringify({ jobId: 124 }),
    })

    const response = await POST(request)
    await mocks.scheduledAfter?.()

    expect(response.status).toBe(200)
    expect(mocks.events).toEqual([
      'token-maintenance',
      'refresh-alert:Refresh rejected',
      'generation-pipeline',
    ])
  })

  it('still starts generation when token maintenance hangs', async () => {
    vi.useFakeTimers()
    mocks.maintainInstagramAccessToken.mockImplementation(() => new Promise(() => undefined))
    mocks.recordInstagramIntegrationFailure.mockResolvedValue({
      sent: true,
      deduplicated: false,
    })

    try {
      const response = await POST(
        new Request('https://example.test/api/internal/generation/run-job', {
          method: 'POST',
          body: JSON.stringify({ jobId: 125 }),
        }),
      )
      const scheduled = mocks.scheduledAfter?.()
      await vi.advanceTimersByTimeAsync(30_000)
      await scheduled

      expect(response.status).toBe(200)
      expect(mocks.runGenerationPipeline).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows enough time for refresh followed by bootstrap validation', async () => {
    vi.useFakeTimers()
    mocks.maintainInstagramAccessToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, action: 'seeded' }), 19_000)
        }),
    )

    try {
      const response = await POST(
        new Request('https://example.test/api/internal/generation/run-job', {
          method: 'POST',
          body: JSON.stringify({ jobId: 127 }),
        }),
      )
      const scheduled = mocks.scheduledAfter?.()
      await vi.advanceTimersByTimeAsync(19_000)
      await scheduled

      expect(response.status).toBe(200)
      expect(mocks.recordInstagramIntegrationFailure).not.toHaveBeenCalled()
      expect(mocks.recordInstagramIntegrationRecovery).not.toHaveBeenCalled()
      expect(mocks.runGenerationPipeline).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not report a refresh failure when only the recovery email fails', async () => {
    mocks.maintainInstagramAccessToken.mockResolvedValue({ ok: true, action: 'refreshed' })
    mocks.recordInstagramIntegrationRecovery.mockRejectedValue(new Error('Resend unavailable'))

    const response = await POST(
      new Request('https://example.test/api/internal/generation/run-job', {
        method: 'POST',
        body: JSON.stringify({ jobId: 126 }),
      }),
    )
    await mocks.scheduledAfter?.()

    expect(response.status).toBe(200)
    expect(mocks.recordInstagramIntegrationFailure).not.toHaveBeenCalled()
    expect(mocks.runGenerationPipeline).toHaveBeenCalledOnce()
  })
})
