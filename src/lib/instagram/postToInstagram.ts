/**
 * Publish a single image with caption to Instagram using the Graph API.
 * Requires Instagram Business/Creator account linked to a Facebook Page.
 * See: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
 */

const INSTAGRAM_API_VERSION = 'v21.0'
const INSTAGRAM_GRAPH_BASE = 'https://graph.instagram.com'

export interface PostToInstagramParams {
  imageUrl: string
  caption: string
  altText?: string
}

export interface PostToInstagramResult {
  ok: boolean
  mediaId?: string
  error?: string
}

/**
 * Create a media container and publish it to Instagram.
 * No-op if INSTAGRAM_ENABLED is not set or credentials are missing.
 */
export async function postToInstagram(
  params: PostToInstagramParams,
): Promise<PostToInstagramResult> {
  const enabled = process.env.INSTAGRAM_ENABLED === 'true'
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
  const igUserId = process.env.INSTAGRAM_IG_USER_ID

  if (!enabled || !accessToken || !igUserId) {
    return { ok: false, error: 'Instagram posting is not configured' }
  }

  const { imageUrl, caption, altText } = params
  if (!imageUrl?.trim() || !caption?.trim()) {
    return { ok: false, error: 'imageUrl and caption are required' }
  }

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
        }),
      },
    )

    const createData = (await createRes.json()) as { id?: string; error?: { message: string } }
    if (!createRes.ok || !createData.id) {
      const msg = createData.error?.message ?? createRes.statusText ?? 'Create container failed'
      return { ok: false, error: msg }
    }

    const containerId = createData.id

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
