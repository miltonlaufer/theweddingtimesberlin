import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'
import { fetchRssTopics } from '@/lib/rss/fetchRssTopics'
import { generateArticle } from '@/lib/generation/generateArticle'
import { generateAuthors } from '@/lib/generation/generateAuthors'
import { generateAndUploadImage } from '@/lib/images/generateAndUploadImage'
import { convertMarkdownToLexical, defaultEditorConfig, sanitizeServerEditorConfig } from '@payloadcms/richtext-lexical'

/******************* LOGGING ***********************/

const LOG_ENDPOINT =
  'http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c'

function log(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'manual-generate',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion agent log
}

/******************* HELPERS ***********************/

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function pickTwoThirds(): boolean {
  return Math.random() < 2 / 3
}

/******************* ROUTE ***********************/

export async function POST(req: Request) {
  // Hypotheses:
  // A: Missing categories/authors in Payload (cannot link relationships)
  // B: Lexical conversion fails due to missing sanitized editor config
  // C: Payload create fails (schema/validation)
  // D: Image generation/upload fails (OpenAI/Supabase)

  const cronSecret = process.env.CRON_SECRET
  const providedSecret = req.headers.get('x-cron-secret')
  const isProd = process.env.NODE_ENV === 'production'

  // In production, require the secret (this endpoint writes into the DB).
  // In dev, allow manual triggering without needing to set/copy headers.
  if (isProd && cronSecret && providedSecret !== cronSecret) {
    log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:70', 'unauthorized', {
      hasCronSecret: true,
      provided: Boolean(providedSecret),
    })
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const publish = url.searchParams.get('publish') !== '0'

  log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:84', 'request', {
    publish,
    isProd,
  })

  const payload = await getPayload()

  const categoriesRes = await payload.find({ collection: 'categories', limit: 100, sort: 'order' })
  const authorsRes = await payload.find({ collection: 'authors', limit: 100, sort: 'name' })

  // Auto-bootstrap: if the DB is empty, seed minimal categories so generation can always run.
  const shouldSeedCategories = (categoriesRes.totalDocs ?? 0) === 0
  if (shouldSeedCategories) {
    log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:96', 'seeding_categories', {
      reason: 'no categories',
    })

    const baselineCategories = [
      { name: 'Bureaucracy', slug: 'bureaucracy', order: 1 },
      { name: 'Leopoldplatz', slug: 'leopoldplatz', order: 2 },
      { name: 'Nightlife', slug: 'nightlife', order: 3 },
      { name: 'Opinion', slug: 'opinion', order: 4 },
      { name: 'Doener & Drinks', slug: 'food-drink', order: 5 },
      { name: 'Crime', slug: 'crime', order: 6 },
      { name: 'Techno', slug: 'techno', order: 7 },
      { name: 'Kiez News', slug: 'kiez', order: 8 },
      { name: 'Gentrification', slug: 'gentrification', order: 9 },
    ]
    for (const cat of baselineCategories) {
      await payload.create({ collection: 'categories', data: cat })
    }
  }

  // Auto-bootstrap authors: ensure we have a pool with bios so the LLM can pick meaningfully.
  const minAuthors = Number(process.env.MIN_AUTHOR_POOL ?? 8)
  const maxNewAuthorsPerRun = Number(process.env.MAX_NEW_AUTHORS_PER_RUN ?? 3)
  const currentAuthorsCount = authorsRes.totalDocs ?? 0

  if (currentAuthorsCount < minAuthors) {
    const toCreate = Math.max(1, Math.min(maxNewAuthorsPerRun, minAuthors - currentAuthorsCount))
    log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:124', 'author_pool_low', {
      currentAuthorsCount,
      minAuthors,
      toCreate,
    })

    const generatedAuthors = await generateAuthors({ count: toCreate })

    for (const a of generatedAuthors) {
      try {
        await payload.create({
          collection: 'authors',
          data: {
            name: a.name,
            slug: a.slug,
            title: a.title,
            bio: a.bio,
          },
        })
      } catch (e) {
        // Ignore duplicates/uniques; just move on.
        log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:151', 'author_create_failed', {
          slug: a.slug,
          message: e instanceof Error ? e.message : 'unknown error',
        })
      }
    }
  }

  const categoriesResFinal =
    shouldSeedCategories
      ? await payload.find({ collection: 'categories', limit: 100, sort: 'order' })
      : categoriesRes
  const authorsResFinal = await payload.find({ collection: 'authors', limit: 200, sort: 'name' })

  const categories = (categoriesResFinal.docs as Array<{ id: string; slug: string; name: string }>).map((c) => ({
    slug: c.slug,
    name: c.name,
  }))
  const authors = (authorsResFinal.docs as Array<{ id: string; slug: string; name: string; title?: string; bio?: string }>).map((a) => ({
    slug: a.slug,
    name: a.name,
    title: a.title,
    bio: a.bio,
  }))

  log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:101', 'options_loaded', {
    categories: categories.length,
    authors: authors.length,
  })

  if (categories.length === 0 || authors.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Need at least 1 category and 1 author in Payload before generating.',
      },
      { status: 400 },
    )
  }

  const includeTopics = pickTwoThirds()
  const { topicSummary } = await fetchRssTopics()

  log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:121', 'topics', {
    includeTopics,
    topicSummaryLen: topicSummary.length,
  })

  const generated = await generateArticle({
    categories,
    authors,
    topicSummary,
    includeTopics,
  })

  log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:132', 'llm_generated', {
    headlineLen: generated.headline.length,
    categorySlug: generated.categorySlug,
    authorSlug: generated.authorSlug,
    hasImagePrompt: Boolean(generated.imagePrompt),
  })

  const categoryDoc = (categoriesResFinal.docs as Array<{ id: string; slug: string }>).find(
    (c) => c.slug === generated.categorySlug,
  )
  const authorDoc = (authorsResFinal.docs as Array<{ id: string; slug: string }>).find(
    (a) => a.slug === generated.authorSlug,
  )

  if (!categoryDoc || !authorDoc) {
    log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:147', 'slug_mapping_failed', {
      categoryFound: Boolean(categoryDoc),
      authorFound: Boolean(authorDoc),
    })
    return NextResponse.json(
      { ok: false, error: 'Generated categorySlug/authorSlug did not match existing Payload docs' },
      { status: 500 },
    )
  }

  const sanitizedEditorConfig = await sanitizeServerEditorConfig(defaultEditorConfig, payload.config)
  const lexical = convertMarkdownToLexical({
    editorConfig: sanitizedEditorConfig,
    markdown: generated.bodyMarkdown,
  })

  log('B', 'src/app/(payload)/api/debug/generate-article/route.ts:165', 'lexical_converted', {
    bodyMarkdownLen: generated.bodyMarkdown.length,
  })

  const slug = `${slugify(generated.headline)}-${Date.now()}`

  let featuredImageUrl: string | undefined
  const imagePrompt = typeof generated.imagePrompt === 'string' ? generated.imagePrompt : ''
  const shouldGenerateImage = pickTwoThirds() && imagePrompt.length > 0

  if (shouldGenerateImage) {
    try {
      const uploaded = await generateAndUploadImage({
        prompt: imagePrompt,
        fileBaseName: slug,
      })
      featuredImageUrl = uploaded.publicUrl
      log('D', 'src/app/(payload)/api/debug/generate-article/route.ts:184', 'image_uploaded', {
        hasUrl: Boolean(featuredImageUrl),
      })
    } catch (e) {
      log('D', 'src/app/(payload)/api/debug/generate-article/route.ts:191', 'image_failed', {
        message: e instanceof Error ? e.message : 'unknown error',
      })
    }
  }

  if (!publish) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      generated: {
        ...generated,
        slug,
        featuredImageUrl: featuredImageUrl ?? null,
      },
    })
  }

  const created = await payload.create({
    collection: 'articles',
    data: {
      headline: generated.headline,
      subheadline: generated.subheadline ?? undefined,
      slug,
      featuredImageUrl,
      imageCaption: generated.imageCaption ?? undefined,
      content: lexical,
      excerpt: generated.excerpt ?? undefined,
      category: categoryDoc.id,
      author: authorDoc.id,
      publishedAt: new Date().toISOString(),
      status: 'published',
      isFeatured: generated.isFeatured,
      isHeadline: generated.isHeadline,
      layout: generated.layout,
    },
  })

  log('C', 'src/app/(payload)/api/debug/generate-article/route.ts:235', 'payload_created', {
    id: created.id,
    slug,
  })

  return NextResponse.json({
    ok: true,
    created: { id: created.id, slug },
    featuredImageUrl: featuredImageUrl ?? null,
  })
}

