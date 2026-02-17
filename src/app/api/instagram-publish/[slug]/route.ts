import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'
import { CANONICAL_SITE_URL } from '@/lib/getBaseUrl'
import { createAndUploadInstagramImage } from '@/lib/instagram/createInstagramImage'
import { postToInstagram } from '@/lib/instagram/postToInstagram'

/******************* DEV-ONLY ***********************/

function isDev(): boolean {
  return process.env.NODE_ENV === 'development'
}

/******************* ROUTE HANDLER ***********************/

/**
 * GET /api/instagram-publish/[slug]
 * Dev-only: fetches the article by slug and publishes it to Instagram (composite image + post).
 * In production this route returns 404.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  if (!isDev()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { slug } = await context.params
  if (!slug?.trim()) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
  }

  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim()
  const igUserId = process.env.INSTAGRAM_IG_USER_ID?.trim()
  if (!accessToken || !igUserId) {
    const missing = [
      !accessToken && 'INSTAGRAM_ACCESS_TOKEN',
      !igUserId && 'INSTAGRAM_IG_USER_ID',
    ].filter(Boolean) as string[]
    return NextResponse.json(
      { error: `Missing Instagram config: ${missing.join(', ')}` },
      { status: 503 },
    )
  }

  const payload = await getPayload()
  if (!payload) {
    return NextResponse.json({ error: 'Payload unavailable' }, { status: 503 })
  }

  const res = await payload.find({
    collection: 'articles',
    where: { slug: { equals: slug.trim() } },
    limit: 1,
    depth: 0,
  })

  const doc = res.docs[0] as
    | { headline?: string; excerpt?: string | null; featuredImageUrl?: string | null }
    | undefined
  if (!doc) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 })
  }

  const imageUrl = doc.featuredImageUrl?.trim()
  const headline = doc.headline?.trim()
  const excerpt = doc.excerpt?.trim() ?? null
  if (!imageUrl || !headline) {
    return NextResponse.json(
      { error: 'Article has no featured image or headline' },
      { status: 400 },
    )
  }

  try {
    const { publicUrl } = await createAndUploadInstagramImage(
      { imageUrl, headline, excerpt },
      slug.trim(),
    )
    const articleUrl = `${CANONICAL_SITE_URL}/article/${slug.trim()}`
    const caption = excerpt
      ? `${headline}\n\n${excerpt}\n\n${articleUrl}`
      : `${headline}\n\n${articleUrl}`

    const result = await postToInstagram(
      {
        imageUrl: publicUrl,
        caption,
        altText: headline,
      },
      { bypassEnabledFlag: true },
    )

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
    }
    return NextResponse.json({ ok: true, mediaId: result.mediaId })
  } catch (err) {
    console.error('[instagram-publish]', err)
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Publish failed',
      },
      { status: 500 },
    )
  }
}
