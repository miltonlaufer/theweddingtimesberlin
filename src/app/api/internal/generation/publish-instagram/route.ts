import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPayload } from '@/lib/payload'
import { CANONICAL_SITE_URL } from '@/lib/getBaseUrl'
import { isInternalCronAuthorized } from '@/lib/generation/internalAuth'
import { createAndUploadInstagramImage } from '@/lib/instagram/createInstagramImage'
import { postToInstagram } from '@/lib/instagram/postToInstagram'

const RequestSchema = z.object({
  slugs: z.array(z.string().min(1)).min(1).max(50),
})

type ArticleDoc = {
  headline?: string
  excerpt?: string | null
  featuredImageUrl?: string | null
}

async function publishOne(slug: string): Promise<{ slug: string; ok: boolean; error?: string }> {
  const payload = await getPayload()
  if (!payload) return { slug, ok: false, error: 'Payload unavailable' }

  const found = await payload.find({
    collection: 'articles',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  })
  const doc = found.docs[0] as ArticleDoc | undefined
  if (!doc) return { slug, ok: false, error: 'Article not found' }

  const headline = doc.headline?.trim()
  const imageUrl = doc.featuredImageUrl?.trim()
  const excerpt = doc.excerpt?.trim() ?? null
  if (!headline || !imageUrl) {
    return { slug, ok: false, error: 'Missing headline or featured image' }
  }

  const { publicUrl } = await createAndUploadInstagramImage({ imageUrl, headline, excerpt }, slug)
  const articleUrl = `${CANONICAL_SITE_URL}/article/${slug}`
  const caption = excerpt
    ? `${headline}\n\n${excerpt}\n\n${articleUrl}`
    : `${headline}\n\n${articleUrl}`
  const result = await postToInstagram({
    imageUrl: publicUrl,
    caption,
    altText: headline,
  })
  if (!result.ok) {
    return { slug, ok: false, error: result.error }
  }

  return { slug, ok: true }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (process.env.INSTAGRAM_ENABLED !== 'true') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'INSTAGRAM_ENABLED is not true',
    })
  }

  const igUserId = process.env.INSTAGRAM_IG_USER_ID?.trim()
  if (!igUserId) {
    return NextResponse.json({ ok: false, error: 'Missing INSTAGRAM_IG_USER_ID' }, { status: 503 })
  }

  let body: z.infer<typeof RequestSchema>
  try {
    body = RequestSchema.parse((await request.json()) as unknown)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Invalid request body' },
      { status: 400 },
    )
  }

  const results = await Promise.all(body.slugs.map((slug) => publishOne(slug.trim())))
  const success = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)

  return NextResponse.json({
    ok: true,
    sent: success,
    failed: failed.length,
    errors: failed.length > 0 ? failed : undefined,
  })
}
