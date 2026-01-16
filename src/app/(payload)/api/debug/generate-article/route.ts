import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'
import { fetchRssTopics } from '@/lib/rss/fetchRssTopics'
import { generateArticle, extractHeadlinePatterns } from '@/lib/generation/generateArticle'
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

function slugToCategoryName(slug: string): string {
  // Convert slug to readable category name
  // e.g., "gentrification" -> "Gentrification", "food-drink" -> "Food & Drink"
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' & ')
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

  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503 })
  }

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

  // Fetch last 50 article titles to avoid repetition and extract patterns
  const recentArticlesRes = await payload.find({
    collection: 'articles',
    where: {
      status: { equals: 'published' },
    },
    limit: 50,
    sort: '-publishedAt',
  })
  const recentArticleTitles = recentArticlesRes.docs
    .map((a) => {
      const doc = a as unknown as { headline?: string }
      return doc.headline
    })
    .filter((title): title is string => typeof title === 'string')

  // Extract headline patterns to avoid repetition (using the enhanced function from generateArticle)
  const recentHeadlinePatterns = extractHeadlinePatterns(recentArticleTitles)
  const uniquePatterns = Array.from(new Set(recentHeadlinePatterns))

  const generated = await generateArticle({
    categories,
    authors,
    topicSummary,
    includeTopics,
    recentArticleTitles: recentArticleTitles.slice(0, 40), // Pass last 40 for topic avoidance and structure variety
    recentHeadlinePatterns: uniquePatterns,
  })

  log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:132', 'llm_generated', {
    headlineLen: generated.headline.length,
    categorySlug: generated.categorySlug,
    authorSlug: generated.authorSlug,
    hasImagePrompt: Boolean(generated.imagePrompt),
    isNewAuthor: Boolean(generated.newAuthorName),
  })

  // Check if category exists, or if we need to create a new one
  let categoryDoc: { id: string | number; slug: string } | undefined = (categoriesResFinal.docs as Array<{ id: string | number; slug: string }>).find(
    (c) => c.slug === generated.categorySlug,
  )

  // If category doesn't exist, create it
  if (!categoryDoc) {
    log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:150', 'creating_new_category', {
      slug: generated.categorySlug,
    })

    try {
      const categoryName = slugToCategoryName(generated.categorySlug)
      // Get the highest order number and add 1, or default to 100
      const maxOrder = Math.max(
        ...(categoriesResFinal.docs as unknown as Array<{ order?: number }>).map((c) => c.order ?? 0),
        0,
      )
      const newOrder = maxOrder + 1

      const newCategory = await payload.create({
        collection: 'categories',
        data: {
          name: categoryName,
          slug: generated.categorySlug,
          order: newOrder,
        },
      })
      categoryDoc = { id: newCategory.id, slug: generated.categorySlug }

      log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:167', 'new_category_created', {
        id: newCategory.id,
        slug: generated.categorySlug,
        name: categoryName,
      })
    } catch (e) {
      log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:172', 'new_category_creation_failed', {
        slug: generated.categorySlug,
        error: e instanceof Error ? e.message : 'unknown error',
      })
      // If creation failed (e.g., duplicate slug), try to find existing category again
      const existingCategory = await payload.find({
        collection: 'categories',
        where: { slug: { equals: generated.categorySlug } },
        limit: 1,
      })
      if (existingCategory.docs.length > 0) {
        const found = existingCategory.docs[0] as { id: string | number; slug: string }
        categoryDoc = { id: found.id, slug: found.slug }
      }
    }
  }
  
  // Check if author exists, or if we need to create a new one
  let authorDoc: { id: string | number; slug: string } | undefined = (authorsResFinal.docs as Array<{ id: string | number; slug: string }>).find(
    (a) => a.slug === generated.authorSlug,
  )

  // If author doesn't exist and new author fields are provided, create the author
  if (!authorDoc && generated.newAuthorName) {
    log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:150', 'creating_new_author', {
      slug: generated.authorSlug,
      name: generated.newAuthorName,
      title: generated.newAuthorTitle,
    })

    try {
      const newAuthor = await payload.create({
        collection: 'authors',
        data: {
          name: generated.newAuthorName,
          slug: generated.authorSlug,
          title: generated.newAuthorTitle ?? undefined,
          bio: generated.newAuthorBio ?? undefined,
        },
      })
      // Keep ID in original format (could be number or string depending on DB)
      authorDoc = { id: newAuthor.id, slug: generated.authorSlug }
      
      log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:167', 'new_author_created', {
        id: newAuthor.id,
        slug: generated.authorSlug,
      })
    } catch (e) {
      log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:172', 'new_author_creation_failed', {
        slug: generated.authorSlug,
        error: e instanceof Error ? e.message : 'unknown error',
      })
      // If creation failed (e.g., duplicate slug), try to find existing author again
      const existingAuthor = await payload.find({
        collection: 'authors',
        where: { slug: { equals: generated.authorSlug } },
        limit: 1,
      })
      if (existingAuthor.docs.length > 0) {
        const found = existingAuthor.docs[0] as { id: string | number; slug: string }
        authorDoc = { id: found.id, slug: found.slug }
      }
    }
  }

  if (!categoryDoc || !authorDoc) {
    const availableCategories = (categoriesResFinal.docs as unknown as Array<{ slug: string }>).map((c) => c.slug).join(', ')
    const availableAuthors = (authorsResFinal.docs as unknown as Array<{ slug: string }>).map((a) => a.slug).join(', ')
    
    log('A', 'src/app/(payload)/api/debug/generate-article/route.ts:147', 'slug_mapping_failed', {
      categoryFound: Boolean(categoryDoc),
      authorFound: Boolean(authorDoc),
      generatedCategorySlug: generated.categorySlug,
      generatedAuthorSlug: generated.authorSlug,
      hasNewAuthorName: Boolean(generated.newAuthorName),
      availableCategories,
      availableAuthors,
    })
    
    let errorMsg = 'Generated categorySlug/authorSlug did not match existing Payload docs. '
    if (!categoryDoc) {
      errorMsg += `Category slug "${generated.categorySlug}" not found. Available: ${availableCategories}. `
    }
    if (!authorDoc) {
      errorMsg += `Author slug "${generated.authorSlug}" not found. `
      if (generated.newAuthorName) {
        errorMsg += `New author creation was attempted but failed. `
      } else {
        errorMsg += `No newAuthorName provided, so author creation was not attempted. `
      }
      errorMsg += `Available: ${availableAuthors}.`
    }
    
    return NextResponse.json(
      { ok: false, error: errorMsg },
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
  const shouldGenerateImage = imagePrompt.length > 0

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

