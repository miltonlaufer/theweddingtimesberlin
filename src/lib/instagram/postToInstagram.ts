/**
 * Publish a single image with caption to Instagram using the Graph API.
 * Requires Instagram Business/Creator account linked to a Facebook Page.
 * See: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
 */

const INSTAGRAM_API_VERSION = 'v21.0'
const INSTAGRAM_GRAPH_BASE = 'https://graph.instagram.com'
const CONTAINER_POLL_INTERVAL_MS = 2500
const CONTAINER_POLL_TIMEOUT_MS = 120000
const PUBLISH_RETRY_INTERVAL_MS = 2000
const PUBLISH_RETRY_ATTEMPTS = 4

export interface PostToInstagramParams {
  imageUrl: string
  caption: string
  altText?: string
  /** Facebook Place/Page ID for post location (e.g. INSTAGRAM_LOCATION_ID for "Wedding, Berlin"). */
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

function shouldRetryPublish(errorMessage?: string): boolean {
  const normalized = (errorMessage ?? '').toLowerCase()
  return normalized.includes('media id is not available')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll container status until FINISHED or ERROR/EXPIRED. Required before media_publish.
 */
async function waitForContainerReady(
  containerId: string,
  accessToken: string,
): Promise<{ ok: boolean; error?: string }> {
  const deadline = Date.now() + CONTAINER_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const res = await fetch(
      `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
    )
    const data = (await res.json()) as { status_code?: string; error?: { message: string } }
    if (data.error) {
      return { ok: false, error: data.error.message ?? 'Failed to get container status' }
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
): Promise<PostToInstagramResult> {
  const publishRes = await fetch(
    `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/${igUserId}/media_publish`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ creation_id: containerId }),
    },
  )

  const publishData = (await publishRes.json()) as { id?: string; error?: { message: string } }
  if (!publishRes.ok || !publishData.id) {
    const msg = publishData.error?.message ?? publishRes.statusText ?? 'Publish failed'
    return { ok: false, error: msg }
  }

  return { ok: true, mediaId: publishData.id }
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
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
  const igUserId = process.env.INSTAGRAM_IG_USER_ID

  if ((!enabled && options?.bypassEnabledFlag !== true) || !accessToken || !igUserId) {
    return { ok: false, error: 'Instagram posting is not configured' }
  }

  const { imageUrl, caption, altText, locationId } = params
  if (!imageUrl?.trim() || !caption?.trim()) {
    return { ok: false, error: 'imageUrl and caption are required' }
  }

  const locationIdToUse = locationId?.trim() || process.env.INSTAGRAM_LOCATION_ID?.trim()

  try {
    const createRes = await fetch(
      `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/${igUserId}/media`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          image_url: imageUrl.trim(),
          caption: caption.trim().slice(0, 2200),
          ...(altText?.trim() ? { alt_text: altText.trim().slice(0, 100) } : {}),
          ...(locationIdToUse ? { location_id: locationIdToUse } : {}),
        }),
      },
    )

    const createData = (await createRes.json()) as { id?: string; error?: { message: string } }
    if (!createRes.ok || !createData.id) {
      const msg = createData.error?.message ?? createRes.statusText ?? 'Create container failed'
      return { ok: false, error: msg }
    }

    const containerId = createData.id

    const ready = await waitForContainerReady(containerId, accessToken)
    if (!ready.ok) {
      return { ok: false, error: ready.error }
    }

    let lastError: string | undefined
    for (let attempt = 0; attempt <= PUBLISH_RETRY_ATTEMPTS; attempt += 1) {
      const published = await publishContainer(igUserId, accessToken, containerId)
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
    return { ok: false, error: message }
  }
}
