import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getPayload } from '@/lib/payload'
import { fetchRssTopics } from '@/lib/rss/fetchRssTopics'
import { generateArticle, extractHeadlinePatterns } from '@/lib/generation/generateArticle'
import { generateAuthors } from '@/lib/generation/generateAuthors'
import { generateAndUploadImage } from '@/lib/images/generateAndUploadImage'
import { sendPushNotifications } from '@/lib/push/sendNotifications'
import {
  convertMarkdownToLexical,
  defaultEditorConfig,
  sanitizeServerEditorConfig,
} from '@payloadcms/richtext-lexical'

/******************* CONSTANTS ***********************/

const MIN_AUTHOR_POOL = Number(process.env.MIN_AUTHOR_POOL ?? 8)
const MAX_NEW_AUTHORS_PER_RUN = Number(process.env.MAX_NEW_AUTHORS_PER_RUN ?? 3)
// Default to 8 articles per run for a fuller newspaper feel (can be overridden via ARTICLES_PER_RUN env var)
const ARTICLES_PER_RUN = Number(process.env.ARTICLES_PER_RUN ?? 8)

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

function slugToCategoryName(slug: string): string {
  // Convert slug to readable category name
  // e.g., "gentrification" -> "Gentrification", "food-drink" -> "Food & Drink"
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' & ')
}

/** Slot config for one article: type decided up front so we can parallelize generation. */
type SlotConfig = {
  forceDrugsTechno: boolean | undefined
  forceStartup: boolean | undefined
  forceRss: boolean | undefined
  forceOpinion: boolean
  includeTopics: boolean
}

/**
 * Precompute what type of article each slot should be.
 * Works for ANY count (1, 4, 8, etc). Assigns guaranteed types by priority,
 * then fills remaining slots with random articles.
 *
 * Priority order:
 * 1. Opinion (if forceOpinionFirst)
 * 2. Drugs/techno (always guaranteed)
 * 3. Startup/gentrification (always guaranteed)
 * 4. RSS-based (if hasRssTopics)
 * 5. Remaining slots = random (internal 35/30/35 split)
 */
function computeSlotConfigs(
  count: number,
  hasRssTopics: boolean,
  forceOpinionFirst: boolean,
): SlotConfig[] {
  // Build the list of guaranteed slot types in priority order
  const guaranteed: SlotConfig[] = []

  if (forceOpinionFirst) {
    guaranteed.push({
      forceDrugsTechno: false,
      forceStartup: false,
      forceRss: false,
      forceOpinion: true,
      includeTopics: false,
    })
  }

  guaranteed.push({
    forceDrugsTechno: true,
    forceStartup: false,
    forceRss: false,
    forceOpinion: false,
    includeTopics: false,
  })

  guaranteed.push({
    forceDrugsTechno: false,
    forceStartup: true,
    forceRss: false,
    forceOpinion: false,
    includeTopics: false,
  })

  if (hasRssTopics) {
    guaranteed.push({
      forceDrugsTechno: false,
      forceStartup: false,
      forceRss: true,
      forceOpinion: false,
      includeTopics: true,
    })
  }

  // Take as many guaranteed slots as we can fit, then fill the rest with random
  const slots: SlotConfig[] = []
  for (let i = 0; i < count; i++) {
    if (i < guaranteed.length) {
      slots.push(guaranteed[i])
    } else {
      // Random slot: let generateArticle's internal random logic decide the theme
      slots.push({
        forceDrugsTechno: undefined,
        forceStartup: undefined,
        forceRss: undefined,
        forceOpinion: false,
        includeTopics: pickTwoThirds(),
      })
    }
  }

  return slots
}

/**
 * Extract plain text from Lexical rich text content.
 * Walks the node tree and extracts text from text nodes.
 */
function extractTextFromLexical(content: unknown): string {
  if (!content || typeof content !== 'object') return ''

  const root = content as { root?: { children?: unknown[] } }
  if (!root.root?.children) return ''

  const extractFromNodes = (nodes: unknown[]): string => {
    const texts: string[] = []
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const n = node as { type?: string; text?: string; children?: unknown[] }

      // Text node
      if (n.type === 'text' && typeof n.text === 'string') {
        texts.push(n.text)
      }
      // Recursively process children
      if (Array.isArray(n.children)) {
        texts.push(extractFromNodes(n.children))
      }
    }
    return texts.join(' ')
  }

  return extractFromNodes(root.root.children).replace(/\s+/g, ' ').trim()
}

/** Result of successfully creating one article (used after parallel generation). */
type CreatedArticleResult = {
  id: string
  slug: string
  featuredImageUrl: string | null
  categorySlug: string
}

/** Shared context for generating a single article (used by parallel workers). */
type GenerateOneContext = {
  payload: Awaited<ReturnType<typeof getPayload>>
  categories: Array<{ slug: string; name: string }>
  authors: Array<{ slug: string; name: string; title?: string; bio?: string }>
  categoriesDocs: Array<{ id: string | number; slug: string; order?: number }>
  authorsDocs: Array<{ id: string | number; slug: string }>
  topicSummary: string
  recentArticleTitles: string[]
  recentArticleExcerpts: string[]
  uniquePatterns: string[]
  latestArticleContentSample: string | undefined
  sanitizedEditorConfig: Awaited<ReturnType<typeof sanitizeServerEditorConfig>>
}

/**
 * Generate one article (LLM + image + DB create). Used in parallel for the whole batch.
 * Resolves category/author from shared docs or creates if missing.
 */
async function generateOneArticle(
  ctx: GenerateOneContext,
  slotIndex: number,
  slot: SlotConfig,
): Promise<CreatedArticleResult> {
  const { payload, categories, authors, categoriesDocs, topicSummary } = ctx
  if (!payload) throw new Error('Payload unavailable')

  const { article: generated, usedRssTopic } = await generateArticle({
    categories,
    authors,
    topicSummary,
    includeTopics: slot.includeTopics,
    recentArticleTitles: ctx.recentArticleTitles.slice(0, 40),
    recentArticleExcerpts: ctx.recentArticleExcerpts.slice(0, 40),
    recentHeadlinePatterns: ctx.uniquePatterns,
    latestArticleContentSample: ctx.latestArticleContentSample,
    forceDrugsTechno: slot.forceDrugsTechno,
    forceStartup: slot.forceStartup,
    forceRss: slot.forceRss,
    forceOpinion: slot.forceOpinion,
  })

  let categoryDoc = categoriesDocs.find((c) => c.slug === generated.categorySlug)
  if (!categoryDoc) {
    try {
      const categoryName = slugToCategoryName(generated.categorySlug)
      const maxOrder = Math.max(...categoriesDocs.map((c) => c.order ?? 0), 0)
      const newCategory = await payload.create({
        collection: 'categories',
        data: {
          name: categoryName,
          slug: generated.categorySlug,
          order: maxOrder + 1,
        },
      })
      categoryDoc = { id: newCategory.id, slug: generated.categorySlug }
    } catch {
      const existingCategory = await payload.find({
        collection: 'categories',
        where: { slug: { equals: generated.categorySlug } },
        limit: 1,
      })
      if (existingCategory.docs.length > 0) {
        const found = existingCategory.docs[0] as { id: string | number; slug: string }
        categoryDoc = { id: found.id, slug: found.slug }
      } else {
        throw new Error(`Failed to create category "${generated.categorySlug}"`)
      }
    }
  }

  const authorsArray = ctx.authorsDocs
  let authorDoc = authorsArray.find((a) => a.slug === generated.authorSlug)
  if (!authorDoc) {
    const withPrefix = `new-author-${generated.authorSlug}`
    authorDoc = authorsArray.find((a) => a.slug === withPrefix)
    if (!authorDoc && generated.authorSlug.startsWith('new-author-')) {
      const withoutPrefix = generated.authorSlug.replace(/^new-author-/, '')
      authorDoc = authorsArray.find((a) => a.slug === withoutPrefix)
    }
    if (!authorDoc) {
      const lowerSlug = generated.authorSlug.toLowerCase()
      authorDoc = authorsArray.find(
        (a) =>
          a.slug.toLowerCase() === lowerSlug ||
          a.slug.toLowerCase() === `new-author-${lowerSlug}` ||
          a.slug.toLowerCase().replace(/^new-author-/, '') === lowerSlug,
      )
    }
  }

  if (!authorDoc && generated.newAuthorName) {
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
      authorDoc = { id: newAuthor.id, slug: generated.authorSlug }
    } catch {
      const existingAuthor = await payload.find({
        collection: 'authors',
        where: { slug: { equals: generated.authorSlug } },
        limit: 1,
      })
      if (existingAuthor.docs.length > 0) {
        const found = existingAuthor.docs[0] as { id: string | number; slug: string }
        authorDoc = { id: found.id, slug: found.slug }
      } else {
        throw new Error(`Failed to create author "${generated.authorSlug}"`)
      }
    }
  }

  if (!authorDoc) {
    throw new Error(`Author slug "${generated.authorSlug}" not found and no newAuthorName provided`)
  }

  const lexical = convertMarkdownToLexical({
    editorConfig: ctx.sanitizedEditorConfig,
    markdown: generated.bodyMarkdown,
  })

  const slug = `${slugify(generated.headline)}-${Date.now()}-${slotIndex}`

  let featuredImageUrl: string | undefined
  const imagePrompt = typeof generated.imagePrompt === 'string' ? generated.imagePrompt : ''
  if (imagePrompt.length > 0) {
    try {
      const uploaded = await generateAndUploadImage({
        prompt: imagePrompt,
        fileBaseName: slug,
      })
      featuredImageUrl = uploaded.publicUrl
    } catch {
      // Continue without image
    }
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
      isHeadline: slotIndex === 0 ? generated.isHeadline : false,
      layout: generated.layout,
      sourceRssTopic: usedRssTopic ?? undefined,
    },
  })

  return {
    id: String(created.id),
    slug,
    featuredImageUrl: featuredImageUrl ?? null,
    categorySlug: generated.categorySlug,
  }
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

    // Check latest opinion article first (before everything): if none or older than 1 week, force an opinion this run
    const categoriesForCheck = await payload.find({
      collection: 'categories',
      limit: 100,
      sort: 'order',
    })
    const opinionCategory = (
      categoriesForCheck.docs as Array<{ id: string | number; slug: string }>
    ).find((c) => c.slug === 'opinion')

    let forceOpinionThisRun = !opinionCategory
    if (opinionCategory) {
      const latestOpinionRes = await payload.find({
        collection: 'articles',
        where: {
          status: { equals: 'published' },
          category: { equals: opinionCategory.id },
        },
        limit: 1,
        sort: '-publishedAt',
        depth: 0,
      })
      const latestOpinion = latestOpinionRes.docs[0] as { publishedAt?: string } | undefined
      if (!latestOpinion?.publishedAt) {
        forceOpinionThisRun = true
      } else {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        forceOpinionThisRun = new Date(latestOpinion.publishedAt).getTime() < weekAgo
      }
    }

    // Fetch authors, recent articles, and RSS topics in parallel (categories already fetched above)
    const [authorsRes, recentArticlesRes, rssTopicsResult] = await Promise.all([
      payload.find({ collection: 'authors', limit: 100, sort: 'name' }),
      payload.find({
        collection: 'articles',
        where: { status: { equals: 'published' } },
        limit: 50,
        sort: '-publishedAt',
        depth: 0, // Don't need relations, just headlines/excerpts
      }),
      fetchRssTopics(),
    ])
    const categoriesRes = categoriesForCheck

    // Filter out RSS topics that were already used by recent articles to prevent cross-batch repetition.
    // Recent articles store the RSS topic they were inspired by in sourceRssTopic.
    const recentlyUsedRssTopics = new Set(
      recentArticlesRes.docs
        .map((a) => {
          const doc = a as unknown as { sourceRssTopic?: string }
          return doc.sourceRssTopic
        })
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .map((t) => t.toLowerCase()),
    )

    // Remove RSS topics that match (or closely match) already-used ones
    const freshTopics = rssTopicsResult.topics.filter(
      (t) => !recentlyUsedRssTopics.has(t.title.toLowerCase()),
    )
    const topicSummary =
      freshTopics.length > 0
        ? freshTopics.map((t) => `- [${t.source}] ${t.title}`).join('\n')
        : rssTopicsResult.topicSummary // fallback to unfiltered if all were used

    // Track final results (may be updated after seeding)
    let categoriesFinal = categoriesRes
    let authorsResFinal = authorsRes

    // Ensure baseline categories exist
    if ((categoriesRes.totalDocs ?? 0) === 0) {
      for (const cat of BASELINE_CATEGORIES) {
        await payload.create({ collection: 'categories', data: cat })
      }
      // Only refetch if we seeded
      categoriesFinal = await payload.find({ collection: 'categories', limit: 100, sort: 'order' })
    }

    // Ensure author pool is sufficient
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

      // Only refetch if we created authors
      authorsResFinal = await payload.find({ collection: 'authors', limit: 100, sort: 'name' })
    }

    // Build options for article generation
    const categories = (
      categoriesFinal.docs as Array<{ id: string; slug: string; name: string }>
    ).map((c) => ({ slug: c.slug, name: c.name }))

    const authors = (
      authorsResFinal.docs as Array<{
        id: string
        slug: string
        name: string
        title?: string
        bio?: string
      }>
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
    const recentArticleTitles = recentArticlesRes.docs
      .map((a) => {
        const doc = a as unknown as { headline?: string }
        return doc.headline
      })
      .filter((title): title is string => typeof title === 'string')

    const recentArticleExcerpts = recentArticlesRes.docs
      .map((a) => {
        const doc = a as unknown as { excerpt?: string }
        return doc.excerpt
      })
      .filter((excerpt): excerpt is string => typeof excerpt === 'string' && excerpt.length > 0)

    // Extract half of the latest article's content to ensure new articles are different
    let latestArticleContentSample: string | undefined
    if (recentArticlesRes.docs.length > 0) {
      const latestDoc = recentArticlesRes.docs[0] as unknown as { content?: unknown }
      if (latestDoc.content) {
        const fullText = extractTextFromLexical(latestDoc.content)
        // Take the first half of the text, up to 1500 characters
        const halfLength = Math.min(Math.floor(fullText.length / 2), 1500)
        if (halfLength > 100) {
          latestArticleContentSample = fullText.slice(0, halfLength) + '...'
        }
      }
    }

    // Extract headline patterns to avoid repetition (using the enhanced function from generateArticle)
    const recentHeadlinePatterns = extractHeadlinePatterns(recentArticleTitles)
    const uniquePatterns = Array.from(new Set(recentHeadlinePatterns))

    // Prepare editor config once
    const sanitizedEditorConfig = await sanitizeServerEditorConfig(
      defaultEditorConfig,
      payload.config,
    )

    // Decide article types for all slots up front, then generate in parallel
    const hasRssTopics = topicSummary.trim().length > 0
    const slotConfigs = computeSlotConfigs(ARTICLES_PER_RUN, hasRssTopics, forceOpinionThisRun)

    const generateOneContext: GenerateOneContext = {
      payload,
      categories,
      authors,
      categoriesDocs: categoriesFinal.docs as Array<{
        id: string | number
        slug: string
        order?: number
      }>,
      authorsDocs: authorsResFinal.docs as Array<{ id: string | number; slug: string }>,
      topicSummary,
      recentArticleTitles,
      recentArticleExcerpts,
      uniquePatterns,
      latestArticleContentSample,
      sanitizedEditorConfig,
    }

    // ⚠️ DO NOT CHANGE THIS TO SEQUENTIAL (e.g. for-loop with await).
    // Parallel generation is REQUIRED — sequential generation causes Vercel cron timeouts.
    // Each article takes 30-60s to generate (LLM + image), so 4-8 articles sequentially = 2-8 min = timeout.
    const results = await Promise.allSettled(
      slotConfigs.map((slot, i) => generateOneArticle(generateOneContext, i, slot)),
    )

    const createdArticles: Array<{ id: string; slug: string; featuredImageUrl: string | null }> = []
    const errors: string[] = []
    const usedCategories = new Set<string>()

    results.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        createdArticles.push({
          id: outcome.value.id,
          slug: outcome.value.slug,
          featuredImageUrl: outcome.value.featuredImageUrl,
        })
        usedCategories.add(outcome.value.categorySlug)
      } else {
        errors.push(
          `Article ${i + 1}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`,
        )
      }
    })

    // Send push notifications if articles were created
    let notificationResult: { sent: number; failed: number; errors: string[] } | null = null
    if (createdArticles.length > 0) {
      try {
        const headlineArticle = createdArticles[0]
        const articleCount = createdArticles.length
        const notificationTitle =
          articleCount === 1 ? 'New Article Published' : `${articleCount} New Articles Published`

        notificationResult = await sendPushNotifications(notificationTitle, {
          body:
            articleCount === 1
              ? 'Check out the latest story!'
              : `Check out ${articleCount} new stories!`,
          icon: '/logo-200x200.png',
          badge: '/logo-200x200.png',
          url: headlineArticle.slug ? `/article/${headlineArticle.slug}` : '/',
          tag: 'new-articles',
        })
      } catch (error) {
        // Log but don't fail the cron job if notifications fail
        console.error('Failed to send push notifications:', error)
      }
    }

    // Revalidate cache for home and archive pages after new articles are created
    const revalidatedPaths: string[] = []
    if (createdArticles.length > 0) {
      try {
        // Revalidate home page
        revalidatePath('/')
        revalidatedPaths.push('/')

        // Revalidate archive page
        revalidatePath('/archive')
        revalidatedPaths.push('/archive')

        // Revalidate section pages for categories that have new articles
        const affectedCategories = new Set(usedCategories)
        for (const categorySlug of affectedCategories) {
          revalidatePath(`/section/${categorySlug}`)
          revalidatedPaths.push(`/section/${categorySlug}`)
        }

        console.log('Revalidated cache for paths:', revalidatedPaths)
      } catch (error) {
        // Log but don't fail the cron job if cache revalidation fails
        console.error('Failed to revalidate cache:', error)
      }
    }

    return NextResponse.json({
      ok: createdArticles.length > 0,
      created: createdArticles,
      errors: errors.length > 0 ? errors : undefined,
      summary: `Created ${createdArticles.length}/${ARTICLES_PER_RUN} articles`,
      notifications: notificationResult
        ? {
            sent: notificationResult.sent,
            failed: notificationResult.failed,
          }
        : undefined,
      revalidated: revalidatedPaths.length > 0 ? revalidatedPaths : undefined,
    })
  } catch (error) {
    console.error('Cron generate error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
