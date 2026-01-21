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

    // Fetch categories, authors, recent articles, and RSS topics in parallel (reduces initial queries)
    const [categoriesRes, authorsRes, recentArticlesRes, rssTopicsResult] = await Promise.all([
      payload.find({ collection: 'categories', limit: 100, sort: 'order' }),
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

    const { topicSummary } = rssTopicsResult

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

    // Generate multiple articles
    const createdArticles: Array<{ id: string; slug: string; featuredImageUrl: string | null }> = []
    const errors: string[] = []
    const usedCategories = new Set<string>()

    // Variety tracking for drugs/techno and RSS
    let lastWasDrugsTechno = false
    let rssArticleCreated = false
    const hasRssTopics = topicSummary.trim().length > 0

    for (let i = 0; i < ARTICLES_PER_RUN; i++) {
      try {
        // Variety logic for drugs/techno: if last article was drugs/techno, this one should NOT be
        // This ensures alternation and variety in the batch
        const forceDrugsTechno = lastWasDrugsTechno ? false : undefined // Force non-drugs if last was drugs, otherwise random

        // RSS logic: ensure at least one article uses RSS topics
        // Force RSS for the last article if none have used it yet and RSS topics are available
        const isLastArticle = i === ARTICLES_PER_RUN - 1
        const forceRss = isLastArticle && !rssArticleCreated && hasRssTopics

        // 2/3 chance to include RSS topics for variety (or forced if forceRss)
        const includeTopics = forceRss || pickTwoThirds()

        // Prefer unused categories, but allow repeats if we've used all
        const unusedCategories = categories.filter((c) => !usedCategories.has(c.slug))
        const categoriesToUse = unusedCategories.length > 0 ? unusedCategories : categories

        // Generate article with category distribution and variety control
        const {
          article: generated,
          usedRssTopic,
          usedDrugsTechno,
        } = await generateArticle({
          categories: categoriesToUse,
          authors,
          topicSummary,
          includeTopics,
          recentArticleTitles: recentArticleTitles.slice(0, 40), // Pass last 40 for topic avoidance and structure variety
          recentArticleExcerpts: recentArticleExcerpts.slice(0, 40), // Parallel array to titles
          recentHeadlinePatterns: uniquePatterns, // Patterns to avoid
          latestArticleContentSample, // Half of latest article to ensure new one is different
          forceDrugsTechno, // Variety control: force non-drugs if last was drugs
          forceRss, // Force RSS if needed for variety
        })

        // Update variety tracking
        lastWasDrugsTechno = usedDrugsTechno
        if (usedRssTopic) {
          rssArticleCreated = true
        }

        // Track used category
        usedCategories.add(generated.categorySlug)

        // Map slugs to IDs - create category if it doesn't exist
        let categoryDoc = (
          categoriesFinal.docs as Array<{ id: string | number; slug: string }>
        ).find((c) => c.slug === generated.categorySlug)

        // If category doesn't exist, create it
        if (!categoryDoc) {
          try {
            const categoryName = slugToCategoryName(generated.categorySlug)
            const maxOrder = Math.max(
              ...(categoriesFinal.docs as unknown as Array<{ order?: number }>).map(
                (c) => c.order ?? 0,
              ),
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

            // Refresh categories list for next iteration
            const refreshedCategories = await payload.find({
              collection: 'categories',
              limit: 100,
              sort: 'order',
            })
            categoriesFinal = refreshedCategories
          } catch {
            // If creation failed, try to find it again (might have been created concurrently)
            const existingCategory = await payload.find({
              collection: 'categories',
              where: { slug: { equals: generated.categorySlug } },
              limit: 1,
            })
            if (existingCategory.docs.length > 0) {
              const found = existingCategory.docs[0] as { id: string | number; slug: string }
              categoryDoc = { id: found.id, slug: found.slug }
            } else {
              errors.push(`Article ${i + 1}: Failed to create category "${generated.categorySlug}"`)
              continue
            }
          }
        }

        // Check if author exists, or if we need to create a new one
        // Try exact match first
        const authorsArray = authorsResFinal.docs as Array<{ id: string | number; slug: string }>
        let authorDoc: { id: string | number; slug: string } | undefined = authorsArray.find(
          (a) => a.slug === generated.authorSlug,
        )

        // If not found, try fuzzy matching (LLM sometimes drops or adds "new-author-" prefix)
        if (!authorDoc) {
          // Try with "new-author-" prefix
          const withPrefix = `new-author-${generated.authorSlug}`
          authorDoc = authorsArray.find((a) => a.slug === withPrefix)

          // Try without "new-author-" prefix
          if (!authorDoc && generated.authorSlug.startsWith('new-author-')) {
            const withoutPrefix = generated.authorSlug.replace(/^new-author-/, '')
            authorDoc = authorsArray.find((a) => a.slug === withoutPrefix)
          }

          // Try case-insensitive match as last resort
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

        // If author doesn't exist and new author fields are provided, create the author
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

            // Refresh authors list for next iteration
            const refreshedAuthors = await payload.find({
              collection: 'authors',
              limit: 100,
              sort: 'name',
            })
            authorsResFinal = refreshedAuthors
          } catch {
            // If creation failed, try to find it again (might have been created concurrently)
            const existingAuthor = await payload.find({
              collection: 'authors',
              where: { slug: { equals: generated.authorSlug } },
              limit: 1,
            })
            if (existingAuthor.docs.length > 0) {
              const found = existingAuthor.docs[0] as { id: string | number; slug: string }
              authorDoc = { id: found.id, slug: found.slug }
            } else {
              errors.push(`Article ${i + 1}: Failed to create author "${generated.authorSlug}"`)
              continue
            }
          }
        }

        if (!authorDoc) {
          errors.push(
            `Article ${i + 1}: Author slug "${generated.authorSlug}" not found and no newAuthorName provided`,
          )
          continue
        }

        // Convert markdown to Lexical
        const lexical = convertMarkdownToLexical({
          editorConfig: sanitizedEditorConfig,
          markdown: generated.bodyMarkdown,
        })

        const slug = `${slugify(generated.headline)}-${Date.now()}-${i}`

        // Generate image if imagePrompt is provided
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
            sourceRssTopic: usedRssTopic ?? undefined, // Track if article was inspired by RSS news (server-side tracking)
          },
        })

        createdArticles.push({
          id: String(created.id),
          slug,
          featuredImageUrl: featuredImageUrl ?? null,
        })

        // Add the new headline to recentArticleTitles to avoid repetition in subsequent iterations
        recentArticleTitles.unshift(generated.headline)
        // Also update the patterns to avoid similar structures
        const newPatterns = extractHeadlinePatterns([generated.headline])
        for (const pattern of newPatterns) {
          if (!uniquePatterns.includes(pattern)) {
            uniquePatterns.push(pattern)
          }
        }
      } catch (error) {
        errors.push(`Article ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

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
