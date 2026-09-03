/**
 * Publish a single image with caption to Instagram using the Graph API.
 * Uses the Instagram API with Instagram Login token flow.
 * See: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
 */

const INSTAGRAM_API_VERSION = 'v21.0'
const INSTAGRAM_GRAPH_BASE = 'https://graph.instagram.com'
const CONTAINER_POLL_INTERVAL_MS = 2500
const CONTAINER_POLL_TIMEOUT_MS = 120000
const API_REQUEST_TIMEOUT_MS = 10_000
const PUBLISH_RETRY_INTERVAL_MS = 2000
const PUBLISH_RETRY_ATTEMPTS = 4

export interface PostToInstagramParams {
  imageUrl: string
  caption: string
  altText?: string
  /** Optional Instagram location ID for post location tagging. */
  locationId?: string
}

export interface PostToInstagramResult {
  ok: boolean
  mediaId?: string
  error?: string
}

export interface PostToInstagramOptions {
  /**
   * Only use in explicit/manual flows (e.g. dev tools). All automated flows
   * should keep honoring INSTAGRAM_ENABLED.
   */
  bypassEnabledFlag?: boolean
}

type ResolvedInstagramToken = {
  accessToken: string
  source: 'env' | 'stored'
}

function shouldRetryPublish(errorMessage?: string): boolean {
  const normalized = (errorMessage ?? '').toLowerCase()
  return normalized.includes('media id is not available')
}

function isTokenRejection(errorMessage?: string): boolean {
  const normalized = (errorMessage ?? '').toLowerCase()
  return (
    normalized.includes('access token') &&
    (normalized.includes('cannot parse') ||
      normalized.includes('could not be decrypted') ||
      normalized.includes('expired') ||
      normalized.includes('invalid') ||
      normalized.includes('malformed') ||
      normalized.includes('error validating'))
  )
}

function normalizeInstagramErrorMessage(errorMessage?: string): string {
  const raw = (errorMessage ?? '').trim()
  const normalized = raw.toLowerCase()

  if (
    normalized.includes('error validating access token') &&
    normalized.includes('session has expired')
  ) {
    return 'Instagram access token expired. Rotate INSTAGRAM_ACCESS_TOKEN in production.'
  }

  if (normalized.includes('error validating access token')) {
    return 'Instagram access token invalid. Check INSTAGRAM_ACCESS_TOKEN in production.'
  }

  return raw || 'Instagram publish failed'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchInstagramJson<T>(
  input: string,
  init: RequestInit | undefined,
  deadlineMs: number,
): Promise<{ response: Response; data: T }> {
  const remainingMs = deadlineMs - Date.now()
  if (remainingMs <= 0) throw new Error('Instagram request timed out')

  const controller = new AbortController()
  const timeoutMs = Math.min(API_REQUEST_TIMEOUT_MS, remainingMs)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('Instagram request timed out'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, { ...init, signal: controller.signal })
        const data = (await response.json()) as T
        return { response, data }
      })(),
      timeoutPromise,
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function getStoredAccessToken(): Promise<ResolvedInstagramToken | null> {
  try {
    const tokenStore = await import('./instagramTokenStore')
    const stored = await tokenStore.readStoredInstagramAccessToken()
    if (!stored?.accessToken.trim()) return null
    return {
      accessToken: stored.accessToken.trim(),
      source: 'stored',
    }
  } catch (error) {
    console.warn('[Instagram] Stored token lookup failed:', error)
    return null
  }
}

async function getEnvAccessToken(): Promise<ResolvedInstagramToken | null> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim()
  if (!accessToken) return null
  return {
    accessToken,
    source: 'env',
  }
}

async function resolveAccessToken(): Promise<ResolvedInstagramToken | null> {
  return (await getStoredAccessToken()) ?? (await getEnvAccessToken())
}

async function refreshAccessToken(accessToken: string): Promise<ResolvedInstagramToken | null> {
  try {
    const tokenStore = await import('./instagramTokenStore')
    const refreshed = await tokenStore.refreshInstagramAccessToken(accessToken)
    if (!refreshed.ok) {
      console.warn('[Instagram] Token refresh failed:', refreshed.error)
      return null
    }

    return {
      accessToken: refreshed.accessToken,
      source: 'stored',
    }
  } catch (error) {
    console.warn('[Instagram] Token refresh failed:', error)
    return null
  }
}

async function persistReplacementEnvToken(accessToken: string): Promise<void> {
  try {
    const tokenStore = await import('./instagramTokenStore')
    const persisted = await tokenStore.writeStoredInstagramAccessToken({
      accessToken,
      refreshedAt: null,
      nextRefreshAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    if (!persisted) {
      console.warn('[Instagram] Replacement environment token worked but was not persisted.')
    }
  } catch (error) {
    console.warn('[Instagram] Replacement environment token could not be persisted:', error)
  }
}

/**
 * Poll container status until FINISHED or ERROR/EXPIRED. Required before media_publish.
 */
async function waitForContainerReady(
  containerId: string,
  accessToken: string,
  deadlineMs: number,
): Promise<{ ok: boolean; error?: string }> {
  while (Date.now() < deadlineMs) {
    const { data } = await fetchInstagramJson<{
      status_code?: string
      error?: { message: string }
    }>(
      `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
      undefined,
      deadlineMs,
    )
    if (data.error) {
      return { ok: false, error: normalizeInstagramErrorMessage(data.error.message) }
    }
    const status = data.status_code
    if (status === 'FINISHED') {
      return { ok: true }
    }
    if (status === 'ERROR' || status === 'EXPIRED') {
      return {
        ok: false,
        error: status === 'EXPIRED' ? 'Container expired' : 'Container processing failed',
      }
    }
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL_MS))
  }
  return { ok: false, error: 'Container did not finish processing in time' }
}

async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string,
  deadlineMs: number,
): Promise<PostToInstagramResult> {
  const body = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  })
  const { response: publishRes, data: publishData } = await fetchInstagramJson<{
    id?: string
    error?: { message: string }
  }>(
    `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/${igUserId}/media_publish`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    deadlineMs,
  )
  if (!publishRes.ok || !publishData.id) {
    const msg = normalizeInstagramErrorMessage(
      publishData.error?.message ?? publishRes.statusText ?? 'Publish failed',
    )
    return { ok: false, error: msg }
  }

  return { ok: true, mediaId: publishData.id }
}

async function publishWithToken(
  params: PostToInstagramParams,
  igUserId: string,
  accessToken: string,
  deadlineMs: number,
): Promise<PostToInstagramResult> {
  const { imageUrl, caption, altText, locationId } = params
  const locationIdToUse = locationId?.trim() || process.env.INSTAGRAM_LOCATION_ID?.trim()

  try {
    const body = new URLSearchParams({
      image_url: imageUrl.trim(),
      caption: caption.trim().slice(0, 2200),
      access_token: accessToken,
    })
    if (altText?.trim()) {
      body.set('alt_text', altText.trim().slice(0, 100))
    }
    if (locationIdToUse) {
      body.set('location_id', locationIdToUse)
    }

    const { response: createRes, data: createData } = await fetchInstagramJson<{
      id?: string
      error?: { message: string }
    }>(
      `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/${igUserId}/media`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
      deadlineMs,
    )
    if (!createRes.ok || !createData.id) {
      const msg = normalizeInstagramErrorMessage(
        createData.error?.message ?? createRes.statusText ?? 'Create container failed',
      )
      return { ok: false, error: msg }
    }

    const containerId = createData.id

    const ready = await waitForContainerReady(containerId, accessToken, deadlineMs)
    if (!ready.ok) {
      return { ok: false, error: ready.error }
    }

    let lastError: string | undefined
    for (let attempt = 0; attempt <= PUBLISH_RETRY_ATTEMPTS; attempt += 1) {
      const published = await publishContainer(igUserId, accessToken, containerId, deadlineMs)
      if (published.ok) {
        return published
      }

      lastError = published.error
      if (!shouldRetryPublish(lastError) || attempt === PUBLISH_RETRY_ATTEMPTS) {
        return { ok: false, error: lastError }
      }

      await sleep(PUBLISH_RETRY_INTERVAL_MS)
    }
    return { ok: false, error: lastError ?? 'Publish failed' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: normalizeInstagramErrorMessage(message) }
  }
}

/**
 * Create a media container and publish it to Instagram.
 * No-op if INSTAGRAM_ENABLED is not set or credentials are missing.
 */
export async function postToInstagram(
  params: PostToInstagramParams,
  options?: PostToInstagramOptions,
): Promise<PostToInstagramResult> {
  const enabled = process.env.INSTAGRAM_ENABLED === 'true'
  const igUserId = process.env.INSTAGRAM_IG_USER_ID?.trim()
  const token = await resolveAccessToken()

  if ((!enabled && options?.bypassEnabledFlag !== true) || !token || !igUserId) {
    return { ok: false, error: 'Instagram posting is not configured' }
  }

  const { imageUrl, caption, altText, locationId } = params
  if (!imageUrl?.trim() || !caption?.trim()) {
    return { ok: false, error: 'imageUrl and caption are required' }
  }
  const deadlineMs = Date.now() + CONTAINER_POLL_TIMEOUT_MS

  const initial = await publishWithToken(
    { imageUrl, caption, altText, locationId },
    igUserId,
    token.accessToken,
    deadlineMs,
  )
  if (initial.ok || !isTokenRejection(initial.error)) {
    return initial
  }

  const refreshed = await refreshAccessToken(token.accessToken)
  if (refreshed) {
    console.warn(
      '[Instagram] Access token was rejected; refreshed token and retrying publish once.',
    )
    const retried = await publishWithToken(
      { imageUrl, caption, altText, locationId },
      igUserId,
      refreshed.accessToken,
      deadlineMs,
    )
    if (retried.ok || token.source === 'env') {
      return retried
    }
  }

  if (token.source === 'stored') {
    const envToken = await getEnvAccessToken()
    if (envToken && envToken.accessToken !== token.accessToken) {
      console.warn('[Instagram] Stored token was rejected; falling back to env token once.')
      const fallbackResult = await publishWithToken(
        { imageUrl, caption, altText, locationId },
        igUserId,
        envToken.accessToken,
        deadlineMs,
      )
      if (fallbackResult.ok) {
        await persistReplacementEnvToken(envToken.accessToken)
      }
      return fallbackResult
    }
  }

  return initial
}
