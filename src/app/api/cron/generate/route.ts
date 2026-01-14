import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'
import { fetchRssTopics } from '@/lib/rss/fetchRssTopics'
import { generateArticle } from '@/lib/generation/generateArticle'
import { generateAuthors } from '@/lib/generation/generateAuthors'
import { generateAndUploadImage } from '@/lib/images/generateAndUploadImage'
import {
  convertMarkdownToLexical,
  defaultEditorConfig,
  sanitizeServerEditorConfig,
} from '@payloadcms/richtext-lexical'

/******************* CONSTANTS ***********************/

const MIN_AUTHOR_POOL = Number(process.env.MIN_AUTHOR_POOL ?? 8)
const MAX_NEW_AUTHORS_PER_RUN = Number(process.env.MAX_NEW_AUTHORS_PER_RUN ?? 3)
const ARTICLES_PER_RUN = Number(process.env.ARTICLES_PER_RUN ?? 4)

const BASELINE_CATEGORIES = [
  { name: 'Bureaucracy', slug: 'bureaucracy', order: 1 },
  { name: 'Leopoldplatz', slug: 'leopoldplatz', order: 2 },
  { name: 'Nightlife', slug: 'nightlife', order: 3 },
  { name: 'Opinion', slug: 'opinion', order: 4 },
  { name: 'Doener & Drinks', slug: 'food-drink', order: 5 },
  { name: 'Crime', slug: 'crime', order: 6 },
  { name: 'Techno', slug: 'techno', order: 7 },
  { name: 'Kiez News', slug: 'kiez', order: 8 },
  { name: 'Gentrification', slug: 'gentrification', order: 9 },
  { name: 'Drugs', slug: 'drugs', order: 10 },
  { name: 'Decadence', slug: 'decadence', order: 11 },
  { name: 'Filth', slug: 'filth', order: 12 },
]

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

/******************* ROUTE HANDLER ***********************/

export async function GET(req: Request) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const providedSecret = authHeader?.replace('Bearer ', '')
  const isProd = process.env.NODE_ENV === 'production'

  // In production, require the secret. In dev, allow manual triggering.
  if (isProd && cronSecret && providedSecret !== cronSecret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await getPayload()

    if (!payload) {
      return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503 })
    }

    // Ensure baseline categories exist
    const categoriesRes = await payload.find({ collection: 'categories', limit: 100, sort: 'order' })
    if ((categoriesRes.totalDocs ?? 0) === 0) {
      for (const cat of BASELINE_CATEGORIES) {
        await payload.create({ collection: 'categories', data: cat })
      }
    }

    // Refresh categories after potential seeding
    const categoriesFinal = await payload.find({ collection: 'categories', limit: 100, sort: 'order' })

    // Ensure author pool is sufficient
    let authorsRes = await payload.find({ collection: 'authors', limit: 100, sort: 'name' })
    const currentAuthorsCount = authorsRes.totalDocs ?? 0

    if (currentAuthorsCount < MIN_AUTHOR_POOL) {
      const toCreate = Math.min(MAX_NEW_AUTHORS_PER_RUN, MIN_AUTHOR_POOL - currentAuthorsCount)

      const newAuthors = await generateAuthors({
        count: toCreate,
      })

      for (const author of newAuthors) {
        try {
          await payload.create({ collection: 'authors', data: author })
        } catch {
          // Slug conflict - skip
        }
      }

      // Refresh authors
      authorsRes = await payload.find({ collection: 'authors', limit: 100, sort: 'name' })
    }

    // Build options for article generation
    const categories = (categoriesFinal.docs as Array<{ id: string; slug: string; name: string }>).map(
      (c) => ({ slug: c.slug, name: c.name }),
    )

    const authors = (
      authorsRes.docs as Array<{ id: string; slug: string; name: string; title?: string; bio?: string }>
    ).map((a) => ({
      slug: a.slug,
      name: a.name,
      title: a.title,
      bio: a.bio,
    }))

    if (categories.length === 0 || authors.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No categories or authors available' },
        { status: 500 },
      )
    }

    // Fetch RSS topics once for all articles
    const { topicSummary } = await fetchRssTopics()

    // Fetch last 10 article titles to avoid repetition
    const recentArticlesRes = await payload.find({
      collection: 'articles',
      where: {
        status: { equals: 'published' },
      },
      limit: 10,
      sort: '-publishedAt',
    })
    const recentArticleTitles = recentArticlesRes.docs
      .map((a) => {
        const doc = a as unknown as { headline?: string }
        return doc.headline
      })
      .filter((title): title is string => typeof title === 'string')

    // Prepare editor config once
    const sanitizedEditorConfig = await sanitizeServerEditorConfig(defaultEditorConfig, payload.config)

    // Generate multiple articles
    const createdArticles: Array<{ id: string; slug: string; featuredImageUrl: string | null }> = []
    const errors: string[] = []
    const usedCategories = new Set<string>()

    for (let i = 0; i < ARTICLES_PER_RUN; i++) {
      try {
        // 2/3 chance to include RSS topics for variety
        const includeTopics = pickTwoThirds()

        // Prefer unused categories, but allow repeats if we've used all
        const unusedCategories = categories.filter((c) => !usedCategories.has(c.slug))
        const categoriesToUse = unusedCategories.length > 0 ? unusedCategories : categories

        // Generate article with category distribution
        const generated = await generateArticle({
          categories: categoriesToUse,
          authors,
          topicSummary,
          includeTopics,
          recentArticleTitles,
        })

        // Track used category
        usedCategories.add(generated.categorySlug)
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: 'cron/generate/route.ts:145',
            message: 'Category selected for article',
            data: {
              articleIndex: i + 1,
              categorySlug: generated.categorySlug,
              usedCategories: Array.from(usedCategories),
              availableCategories: categoriesToUse.map((c) => c.slug),
              wasUnused: unusedCategories.length > 0,
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'category-distribution',
            hypothesisId: 'A',
          }),
        }).catch(() => {})
        // #endregion agent log

        // Map slugs to IDs
        const categoryDoc = (categoriesFinal.docs as Array<{ id: string; slug: string }>).find(
          (c) => c.slug === generated.categorySlug,
        )
        const authorDoc = (authorsRes.docs as Array<{ id: string; slug: string }>).find(
          (a) => a.slug === generated.authorSlug,
        )

        if (!categoryDoc || !authorDoc) {
          errors.push(`Article ${i + 1}: Generated slugs did not match existing documents`)
          continue
        }

        // Convert markdown to Lexical
        const lexical = convertMarkdownToLexical({
          editorConfig: sanitizedEditorConfig,
          markdown: generated.bodyMarkdown,
        })

        const slug = `${slugify(generated.headline)}-${Date.now()}-${i}`

        // Generate image (2/3 chance)
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
          } catch {
            // Image generation failed - continue without image
          }
        }

        // Create article in Payload
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
            isHeadline: i === 0 ? generated.isHeadline : false, // Only first can be headline
            layout: generated.layout,
          },
        })

        createdArticles.push({
          id: String(created.id),
          slug,
          featuredImageUrl: featuredImageUrl ?? null,
        })
      } catch (error) {
        errors.push(`Article ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    return NextResponse.json({
      ok: createdArticles.length > 0,
      created: createdArticles,
      errors: errors.length > 0 ? errors : undefined,
      summary: `Created ${createdArticles.length}/${ARTICLES_PER_RUN} articles`,
    })
  } catch (error) {
    console.error('Cron generate error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
