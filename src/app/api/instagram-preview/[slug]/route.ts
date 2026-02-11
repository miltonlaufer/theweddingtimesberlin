import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'
import { createInstagramImageBuffer } from '@/lib/instagram/createInstagramImage'

/******************* DEV-ONLY ***********************/

function isDev(): boolean {
  return process.env.NODE_ENV === 'development'
}

/******************* ROUTE HANDLER ***********************/

/**
 * GET /api/instagram-preview/[slug]
 * Dev-only: fetches the article by slug and returns the Instagram composite image (image + text overlay).
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
  if (!imageUrl || !headline) {
    return NextResponse.json(
      { error: 'Article has no featured image or headline' },
      { status: 400 },
    )
  }

  try {
    const buffer = await createInstagramImageBuffer({
      imageUrl,
      headline,
      excerpt: doc.excerpt?.trim() ?? null,
    })
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[instagram-preview]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate image' },
      { status: 500 },
    )
  }
}
