import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as tokenStore from './instagramTokenStore'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
}))

vi.mock('@/lib/payload', () => ({
  getPayload: mocks.getPayload,
}))

describe('Instagram token refresh scheduling', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'))
    process.env = {
      ...originalEnv,
      INSTAGRAM_ACCESS_TOKEN: 'fresh-env-token',
    }
    mocks.getPayload.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not refresh a token before 30 days have elapsed', () => {
    const isRefreshDue = (
      tokenStore as typeof tokenStore & {
        isInstagramTokenRefreshDue?: (
          token: { refreshedAt?: string | null; expiresAt?: string | null },
          now: Date,
        ) => boolean
      }
    ).isInstagramTokenRefreshDue

    const due = isRefreshDue?.(
      {
        refreshedAt: '2026-08-05T12:00:00.000Z',
        expiresAt: '2026-10-04T12:00:00.000Z',
      },
      new Date('2026-09-03T12:00:00.000Z'),
    )

    expect(due).toBe(false)
  })

  it('refreshes and stores an environment token during bootstrap', async () => {
    const docs: Array<Record<string, unknown>> = []
    mocks.getPayload.mockResolvedValue({
      find: vi.fn().mockResolvedValue({ docs }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        docs.push({ id: 1, ...data })
        return docs[0]
      }),
      update: vi.fn(),
    })
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        access_token: 'bootstrapped-token',
        token_type: 'bearer',
        expires_in: 5_184_000,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const maintain = (
      tokenStore as typeof tokenStore & {
        maintainInstagramAccessToken?: () => Promise<{
          ok: boolean
          action: string
        }>
      }
    ).maintainInstagramAccessToken

    const result = await maintain?.()

    expect(result).toEqual({ ok: true, action: 'refreshed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toEqual(
      expect.objectContaining({
        cacheType: 'blacklist-summary',
        cacheKey: 'instagram-token-state:v1',
        expiresAt: '2026-11-02T12:00:00.000Z',
      }),
    )
    expect(JSON.parse(String(docs[0].summary))).not.toEqual(
      expect.objectContaining({ tokenLength: expect.anything(), tokenPrefix: expect.anything() }),
    )
  })

  it('validates a too-new environment token and delays its refresh retry', async () => {
    const docs: Array<Record<string, unknown>> = []
    mocks.getPayload.mockResolvedValue({
      find: vi.fn().mockImplementation(async () => ({ docs })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        docs.push({ id: 1, ...data })
        return docs[0]
      }),
      update: vi.fn(),
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: 'Token can only be refreshed after 24 hours' } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ id: 'ig-user' }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await tokenStore.maintainInstagramAccessToken()
    const immediateRetry = await tokenStore.maintainInstagramAccessToken()

    expect(first).toEqual({ ok: true, action: 'seeded' })
    expect(immediateRetry).toEqual({ ok: true, action: 'fresh' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refreshes before a token reaches its expiry safety window', () => {
    expect(
      tokenStore.isInstagramTokenRefreshDue(
        {
          refreshedAt: '2026-08-20T12:00:00.000Z',
          expiresAt: '2026-09-08T12:00:00.000Z',
        },
        new Date('2026-09-03T12:00:00.000Z'),
      ),
    ).toBe(true)
  })

  it('fails closed in production without a dedicated encryption key', async () => {
    process.env = {
      ...process.env,
      NODE_ENV: 'production',
    }
    delete process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY

    mocks.getPayload.mockResolvedValue({
      find: vi.fn().mockResolvedValue({ docs: [] }),
      create: vi.fn(),
      update: vi.fn(),
    })

    await expect(
      tokenStore.writeStoredInstagramAccessToken({ accessToken: 'must-not-be-stored' }),
    ).rejects.toThrow('INSTAGRAM_TOKEN_ENCRYPTION_KEY')
  })

  it('refreshes a stored token after 30 days', async () => {
    const docs: Array<Record<string, unknown>> = []
    mocks.getPayload.mockResolvedValue({
      find: vi.fn().mockImplementation(async () => ({ docs })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        docs.push({ id: 1, ...data })
        return docs[0]
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'bootstrapped-token',
          token_type: 'bearer',
          expires_in: 5_184_000,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'refreshed-token',
          token_type: 'bearer',
          expires_in: 5_184_000,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const seeded = await tokenStore.maintainInstagramAccessToken()
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'))
    const refreshed = await tokenStore.maintainInstagramAccessToken()

    expect(seeded).toEqual({ ok: true, action: 'refreshed' })
    expect(refreshed).toEqual({ ok: true, action: 'refreshed' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await tokenStore.readStoredInstagramAccessToken()).toEqual(
      expect.objectContaining({
        accessToken: 'refreshed-token',
        refreshedAt: '2026-10-04T12:00:00.000Z',
        expiresAt: '2026-12-03T12:00:00.000Z',
      }),
    )
  })
})
