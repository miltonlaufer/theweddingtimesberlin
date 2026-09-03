import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postToInstagram } from './postToInstagram'

const mocks = vi.hoisted(() => ({
  readStoredInstagramAccessToken: vi.fn(),
  refreshInstagramAccessToken: vi.fn(),
  writeStoredInstagramAccessToken: vi.fn(),
}))

vi.mock('./instagramTokenStore', () => ({
  readStoredInstagramAccessToken: mocks.readStoredInstagramAccessToken,
  refreshInstagramAccessToken: mocks.refreshInstagramAccessToken,
  writeStoredInstagramAccessToken: mocks.writeStoredInstagramAccessToken,
}))

describe('postToInstagram token fallback', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INSTAGRAM_ENABLED: 'true',
      INSTAGRAM_IG_USER_ID: 'ig-user',
      INSTAGRAM_ACCESS_TOKEN: 'replacement-env-token',
    }
    mocks.readStoredInstagramAccessToken.mockReset()
    mocks.refreshInstagramAccessToken.mockReset()
    mocks.writeStoredInstagramAccessToken.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('bounds a stalled Instagram API request', async () => {
    vi.useFakeTimers()
    mocks.readStoredInstagramAccessToken.mockResolvedValue(null)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    )

    const attempt = postToInstagram({
      imageUrl: 'https://images.example/story.png',
      caption: 'Story caption',
    })
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(attempt).resolves.toEqual({
      ok: false,
      error: 'Instagram request timed out',
    })
  })

  it('bounds a stalled Instagram response body', async () => {
    vi.useFakeTimers()
    mocks.readStoredInstagramAccessToken.mockResolvedValue(null)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: '',
        json: () => new Promise(() => undefined),
      }),
    )

    const attempt = postToInstagram({
      imageUrl: 'https://images.example/story.png',
      caption: 'Story caption',
    })
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(attempt).resolves.toEqual({
      ok: false,
      error: 'Instagram request timed out',
    })
  })

  it('persists a working environment token after the stored token is rejected', async () => {
    let persistedToken: string | null = null
    mocks.readStoredInstagramAccessToken.mockResolvedValue({
      accessToken: 'rejected-stored-token',
      source: 'stored',
    })
    mocks.refreshInstagramAccessToken.mockResolvedValue({
      ok: false,
      error: 'Refresh rejected',
    })
    mocks.writeStoredInstagramAccessToken.mockImplementation(
      async ({ accessToken }: { accessToken: string }) => {
        persistedToken = accessToken
        return true
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/ig-user/media')) {
          const body = init?.body as URLSearchParams
          if (body.get('access_token') === 'rejected-stored-token') {
            return Response.json(
              { error: { message: 'Error validating access token: invalid token' } },
              { status: 401 },
            )
          }
          return Response.json({ id: 'container-1' })
        }
        if (url.pathname.endsWith('/container-1')) {
          return Response.json({ status_code: 'FINISHED' })
        }
        if (url.pathname.endsWith('/ig-user/media_publish')) {
          return Response.json({ id: 'media-1' })
        }
        return Response.json({ error: { message: 'Unexpected request' } }, { status: 500 })
      }),
    )

    const result = await postToInstagram({
      imageUrl: 'https://images.example/story.png',
      caption: 'Story caption',
    })

    expect(result).toEqual({ ok: true, mediaId: 'media-1' })
    expect(persistedToken).toBe('replacement-env-token')
    expect(mocks.writeStoredInstagramAccessToken).toHaveBeenCalledWith({
      accessToken: 'replacement-env-token',
      refreshedAt: null,
      nextRefreshAt: expect.any(String),
    })
  })
})
