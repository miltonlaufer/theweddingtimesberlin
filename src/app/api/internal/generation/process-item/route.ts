import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPayload } from '@/lib/payload'
import { generateAndUploadImage } from '@/lib/images/generateAndUploadImage'
import {
  generateArticle,
  isRetryableGenerationError,
  type GeneratorAuthorOption,
  type GeneratorCategoryOption,
} from '@/lib/generation/generateArticle'
import {
  getInternalCronTokenForCalls,
  isInternalCronAuthorized,
} from '@/lib/generation/internalAuth'
import type { DraftCandidate, RecentCoverageItem, SlotConfig } from '@/lib/generation/pipelineTypes'
import { evaluateDraftCandidate, generateDraftCandidate } from '@/lib/generation/draftPipeline'
import { tryFinalizeGenerationJob } from '@/lib/generation/runGenerationPipeline'
import { buildSummaryFromMarkdownContent } from '@/lib/text/articleSummary'
import { normalizeOptionalExcerptForStorage } from '@/lib/text/excerptQuality'
import { normalizeOptionalSubheadlineForStorage } from '@/lib/text/subheadline'
import { CANONICAL_SITE_URL } from '@/lib/getBaseUrl'
import { createAndUploadInstagramImage } from '@/lib/instagram/createInstagramImage'
import { postToInstagram } from '@/lib/instagram/postToInstagram'
import {
  convertMarkdownToLexical,
  defaultEditorConfig,
  sanitizeServerEditorConfig,
} from '@payloadcms/richtext-lexical'

export const maxDuration = 300
const LOG_PREFIX = '[INTERNAL-PROCESS-ITEM]'

const MAX_GENERATION_ATTEMPTS = Math.max(1, Number(process.env.GENERATION_MAX_ATTEMPTS ?? 3))
const AUTHOR_CONTEXT_LIMIT = Math.max(8, Number(process.env.GENERATION_AUTHOR_CONTEXT_LIMIT ?? 28))
const AUTHOR_CONTEXT_RECENT_PRIORITY = Math.max(
  4,
  Number(process.env.GENERATION_AUTHOR_CONTEXT_RECENT_PRIORITY ?? 18),
)
const AUTHOR_USAGE_LOOKBACK = Math.max(
  20,
  Number(process.env.GENERATION_AUTHOR_USAGE_LOOKBACK ?? 120),
)
const GENERATION_NEW_AUTHOR_POOL_THRESHOLD = Math.max(
  0,
  Number(process.env.GENERATION_NEW_AUTHOR_POOL_THRESHOLD ?? 60),
)
const GENERATION_NEW_AUTHOR_PROBABILITY = Math.min(
  1,
  Math.max(0, Number(process.env.GENERATION_NEW_AUTHOR_PROBABILITY ?? 0.05)),
)
const GENERATION_REDRAFT_ON_REPETITION =
  (process.env.GENERATION_REDRAFT_ON_REPETITION ?? 'true') !== 'false'
const GENERATION_REDRAFT_ATTEMPTS_PER_FAILURE = Math.max(
  1,
  Number(process.env.GENERATION_REDRAFT_ATTEMPTS_PER_FAILURE ?? 3),
)
const GENERATION_REDRAFT_ACCEPT_NON_OVERLAP =
  (process.env.GENERATION_REDRAFT_ACCEPT_NON_OVERLAP ?? 'true') !== 'false'

const RequestSchema = z.object({
  jobId: z.union([z.string(), z.number()]),
  itemId: z.union([z.string(), z.number()]),
  slot: z.object({
    forceDrugsTechno: z.boolean().optional(),
    forceStartup: z.boolean().optional(),
    forceRss: z.boolean().optional(),
    forceOpinion: z.boolean(),
    includeTopics: z.boolean(),
    useHumorPerspectiveMethod: z.boolean().optional(),
    themeBucket: z.string().max(80).optional(),
    editorDirection: z.string().max(1200).optional(),
  }),
  topicSummary: z.string(),
  recentArticleTitles: z.array(z.string()).default([]),
  recentArticleExcerpts: z.array(z.string()).default([]),
  recentCanonicalStoryReferences: z
    .array(z.object({ author: z.string(), story: z.string() }))
    .default([]),
  precomputedBlacklistSummary: z.string().default(''),
  recentHeadlinePatterns: z.array(z.string()).default([]),
  latestArticleContentSample: z.string().optional(),
  publish: z.boolean().optional().default(true),
  setAsHeadline: z.boolean().optional().default(false),
})

type JobItemDoc = {
  id: string | number
  job?: string | number | { id: string | number }
  status?: string
  headline?: string
  subheadline?: string | null
  excerpt?: string | null
  sourceRssTopic?: string | null
}

type AuthorDoc = {
  id: string | number
  slug: string
  name: string
  title?: string
  bio?: string
}

type AuthorRef = {
  id: string | number
  slug: string
}

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }
  return hash
}

function normalizeRecentCoverage(titles: string[], excerpts: string[]): RecentCoverageItem[] {
  return titles
    .slice(0, 30)
    .map((headline, index) => ({
      headline: headline.trim(),
      excerpt: (excerpts[index] ?? '').trim(),
    }))
    .filter((item) => item.headline.length > 0)
}

function extractRepetitionMatchedReference(errorMessage: string): string | null {
  const match = errorMessage.match(/matched="([^"]+)"/)
  if (!match?.[1]) return null
  const normalized = match[1].replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function getAuthorIdFromArticleDoc(doc: unknown): string | number | null {
  if (!doc || typeof doc !== 'object') return null
  const relation = (doc as { author?: unknown }).author
  if (typeof relation === 'string' || typeof relation === 'number') return relation
  if (!relation || typeof relation !== 'object') return null
  const relId = (relation as { id?: unknown }).id
  if (typeof relId === 'string' || typeof relId === 'number') return relId
  return null
}

async function maybePublishInstagram(args: {
  slug: string
  headline: string
  excerpt: string | null
  featuredImageUrl: string
}) {
  if (process.env.INSTAGRAM_AUTO_POST_ON_ARTICLE_CREATE === 'true') {
    return {
      attempted: false,
      queuedByArticleHook: true,
      skipped: true,
      reason: 'Handled by article afterChange hook',
    }
  }

  if (process.env.CRON_AUTO_PUBLISH_INSTAGRAM !== 'true') {
    return {
      attempted: false,
      queuedByArticleHook: false,
      skipped: true,
      reason: 'CRON_AUTO_PUBLISH_INSTAGRAM is not true',
    }
  }

  if (process.env.INSTAGRAM_ENABLED !== 'true') {
    return {
      attempted: false,
      queuedByArticleHook: false,
      skipped: true,
      reason: 'INSTAGRAM_ENABLED is not true',
    }
  }

  const igUserId = process.env.INSTAGRAM_IG_USER_ID?.trim()
  if (!igUserId) {
    return {
      attempted: false,
      queuedByArticleHook: false,
      skipped: true,
      reason: 'Missing INSTAGRAM_IG_USER_ID',
    }
  }

  const { publicUrl } = await createAndUploadInstagramImage(
    {
      imageUrl: args.featuredImageUrl,
      headline: args.headline,
      excerpt: args.excerpt,
    },
    args.slug,
  )

  const articleUrl = `${CANONICAL_SITE_URL}/article/${args.slug}`
  const caption = args.excerpt
    ? `${args.headline}\n\n${args.excerpt}\n\n${articleUrl}`
    : `${args.headline}\n\n${articleUrl}`

  const result = await postToInstagram({
    imageUrl: publicUrl,
    caption,
    altText: args.headline,
  })

  return {
    attempted: true,
    queuedByArticleHook: false,
    skipped: !result.ok,
    reason: result.ok ? undefined : result.error,
  }
}

function pickAuthorContext(params: {
  authors: AuthorDoc[]
  recentAuthorIds: Array<string | number>
  limit: number
  recentPriority: number
  rotationSeed: string
}): AuthorDoc[] {
  const { authors, recentAuthorIds, limit, recentPriority, rotationSeed } = params
  if (authors.length <= limit) return authors

  const usage = new Map<string, number>()
  for (const id of recentAuthorIds) {
    const key = String(id)
    usage.set(key, (usage.get(key) ?? 0) + 1)
  }

  const sortedByUsage = [...authors]
    .map((author) => ({
      author,
      usageCount: usage.get(String(author.id)) ?? 0,
    }))
    .sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount
      return a.author.slug.localeCompare(b.author.slug)
    })

  const selected: AuthorDoc[] = []
  const selectedSlugs = new Set<string>()
  const cappedRecentPriority = Math.min(limit, recentPriority)

  for (const entry of sortedByUsage) {
    if (entry.usageCount <= 0 || selected.length >= cappedRecentPriority) break
    selected.push(entry.author)
    selectedSlugs.add(entry.author.slug)
  }

  const remaining = authors
    .filter((author) => !selectedSlugs.has(author.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug))

  if (remaining.length > 0 && selected.length < limit) {
    const offset = hashString(rotationSeed) % remaining.length
    const rotated = [...remaining.slice(offset), ...remaining.slice(0, offset)]
    for (const author of rotated) {
      selected.push(author)
      if (selected.length >= limit) break
    }
  }

  return selected.slice(0, limit)
}

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
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' & ')
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isInternalCronAuthorized(request)) {
    console.warn(`${LOG_PREFIX} Unauthorized request`)
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  const tokenForInternalCalls = getInternalCronTokenForCalls(request)
  const baseUrl = request.url

  let body: z.infer<typeof RequestSchema>
  try {
    body = RequestSchema.parse((await request.json()) as unknown)
  } catch (error) {
    console.warn(`${LOG_PREFIX} Invalid request body`, error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Invalid request body' },
      { status: 400 },
    )
  }
  console.log(
    `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} start | publish=${body.publish} setAsHeadline=${body.setAsHeadline}`,
  )

  const payload = await getPayload()
  if (!payload) {
    console.warn(
      `${LOG_PREFIX} Payload unavailable for job ${String(body.jobId)} item ${String(body.itemId)}`,
    )
    return NextResponse.json({ ok: false, error: 'Payload unavailable' }, { status: 503 })
  }

  const item = (await payload.findByID({
    collection: 'generation-job-items',
    id: body.itemId,
    depth: 0,
  })) as unknown as JobItemDoc

  if (!item?.id) {
    return NextResponse.json({ ok: false, error: 'Job item not found' }, { status: 404 })
  }

  const itemJobId =
    typeof item.job === 'object' && item.job
      ? String(item.job.id)
      : item.job
        ? String(item.job)
        : ''
  if (itemJobId !== String(body.jobId)) {
    return NextResponse.json({ ok: false, error: 'Item does not belong to job' }, { status: 400 })
  }

  if (!item.headline?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'Item has no accepted draft headline' },
      { status: 400 },
    )
  }
  if (item.status !== 'draft-accepted' && item.status !== 'processing') {
    return NextResponse.json(
      { ok: false, error: `Item status must be draft-accepted (got ${item.status ?? 'unknown'})` },
      { status: 400 },
    )
  }

  await payload.update({
    collection: 'generation-job-items',
    id: body.itemId,
    data: {
      status: 'processing',
      startedAt: new Date().toISOString(),
      error: undefined,
    },
  })

  try {
    const [categoriesRes, authorsRes, recentArticlesForAuthors] = await Promise.all([
      payload.find({ collection: 'categories', limit: 200, sort: 'order' }),
      payload.find({ collection: 'authors', limit: 600, sort: 'name' }),
      payload.find({
        collection: 'articles',
        where: { status: { equals: 'published' } },
        limit: AUTHOR_USAGE_LOOKBACK,
        sort: '-publishedAt',
        depth: 0,
      }),
    ])

    const categories = (categoriesRes.docs as unknown as Array<{ slug: string; name: string }>).map(
      (c) => ({
        slug: c.slug,
        name: c.name,
      }),
    ) as GeneratorCategoryOption[]
    const authorsDocs: AuthorDoc[] = (authorsRes.docs as unknown as Array<Partial<AuthorDoc>>)
      .filter(
        (a): a is AuthorDoc =>
          a != null &&
          a.id != null &&
          typeof a.slug === 'string' &&
          a.slug.length > 0 &&
          typeof a.name === 'string' &&
          a.name.length > 0,
      )
      .map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        title: a.title,
        bio: a.bio,
      }))

    if (authorsDocs.length === 0) {
      throw new Error('No authors available')
    }

    const recentAuthorIds = recentArticlesForAuthors.docs
      .map((doc) => getAuthorIdFromArticleDoc(doc))
      .filter((id): id is string | number => id != null)

    const authorContextDocs = pickAuthorContext({
      authors: authorsDocs,
      recentAuthorIds,
      limit: AUTHOR_CONTEXT_LIMIT,
      recentPriority: AUTHOR_CONTEXT_RECENT_PRIORITY,
      rotationSeed: `${String(body.jobId)}:${String(body.itemId)}`,
    })

    const authors = authorContextDocs.map((author) => ({
      slug: author.slug,
      name: author.name,
      title: author.title,
      // Intentionally omit bios from context to reduce token usage.
    })) as GeneratorAuthorOption[]
    console.log(
      `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} authors context | total=${authorsDocs.length} recentRefs=${recentAuthorIds.length} sentToLLM=${authors.length}`,
    )

    const slot: SlotConfig = {
      forceDrugsTechno: body.slot.forceDrugsTechno,
      forceStartup: body.slot.forceStartup,
      forceRss: body.slot.forceRss,
      forceOpinion: body.slot.forceOpinion,
      includeTopics: body.slot.includeTopics,
      useHumorPerspectiveMethod: body.slot.useHumorPerspectiveMethod,
      themeBucket: body.slot.themeBucket,
      editorDirection: body.slot.editorDirection,
    }

    let generated: Awaited<ReturnType<typeof generateArticle>>['article'] | undefined
    let usedRssTopic: string | null = null
    let lastError: unknown
    let seedDraft: DraftCandidate = {
      headline: item.headline.trim(),
      subheadline: item.subheadline?.trim() || null,
      excerpt: item.excerpt?.trim() || null,
    }
    let seedTopicHint = item.sourceRssTopic ?? null
    const triedSourceTopicsForItem = new Set<string>()
    if (typeof seedTopicHint === 'string' && seedTopicHint.trim().length > 0) {
      triedSourceTopicsForItem.add(seedTopicHint.trim())
    }
    const recentCoverage = normalizeRecentCoverage(
      body.recentArticleTitles,
      body.recentArticleExcerpts,
    )
    const dynamicCoverage: RecentCoverageItem[] = [...recentCoverage]
    const attemptedDrafts: DraftCandidate[] = [seedDraft]
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      console.log(
        `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} generate attempt ${attempt}/${MAX_GENERATION_ATTEMPTS}`,
      )
      try {
        const result = await generateArticle({
          categories,
          authors,
          topicSummary: body.topicSummary,
          includeTopics: slot.includeTopics,
          recentArticleTitles: body.recentArticleTitles.slice(0, 20),
          recentArticleExcerpts: body.recentArticleExcerpts.slice(0, 20),
          recentCanonicalStoryReferences: body.recentCanonicalStoryReferences.slice(0, 20),
          precomputedBlacklistSummary: body.precomputedBlacklistSummary,
          recentHeadlinePatterns: body.recentHeadlinePatterns,
          latestArticleContentSample: body.latestArticleContentSample,
          forceDrugsTechno: slot.forceDrugsTechno,
          forceStartup: slot.forceStartup,
          forceRss: slot.forceRss,
          forceOpinion: slot.forceOpinion,
          useHumorPerspectiveMethod: slot.useHumorPerspectiveMethod,
          editorDirection: slot.editorDirection,
          seedDraft: {
            headline: seedDraft.headline,
            subheadline: seedDraft.subheadline,
            excerpt: seedDraft.excerpt,
            topicHint: seedTopicHint,
          },
        })
        generated = result.article
        usedRssTopic = result.usedRssTopic
        console.log(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} generation succeeded on attempt ${attempt}`,
        )
        break
      } catch (error) {
        lastError = error
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} generate attempt ${attempt} failed (${reason})`,
        )
        const retryableRepetition = isRetryableGenerationError(error)
        if (!retryableRepetition || attempt >= MAX_GENERATION_ATTEMPTS) {
          throw error
        }

        const matchedReference = extractRepetitionMatchedReference(reason)
        if (matchedReference) {
          dynamicCoverage.push({
            headline: matchedReference.slice(0, 140),
            excerpt: matchedReference.slice(0, 280),
          })
          console.log(
            `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} repetition match captured for next redraft | "${matchedReference.slice(0, 120)}"`,
          )
        }

        if (!GENERATION_REDRAFT_ON_REPETITION) {
          continue
        }

        try {
          let selectedDraft: DraftCandidate | null = null
          let selectedTopicHint: string | null = seedTopicHint
          let selectedEvaluation: Awaited<ReturnType<typeof evaluateDraftCandidate>> | null = null

          for (
            let pivotAttempt = 1;
            pivotAttempt <= GENERATION_REDRAFT_ATTEMPTS_PER_FAILURE;
            pivotAttempt++
          ) {
            const acceptedDrafts: DraftCandidate[] = [...attemptedDrafts]
            const regeneratedDraft = await generateDraftCandidate({
              slot,
              topicSummary: body.topicSummary,
              recentCoverage: dynamicCoverage,
              blacklistSummary: body.precomputedBlacklistSummary,
              acceptedDrafts,
              forbiddenSourceTopics: Array.from(triedSourceTopicsForItem),
            })
            if (
              typeof regeneratedDraft.sourceRssTopic === 'string' &&
              regeneratedDraft.sourceRssTopic.trim().length > 0
            ) {
              triedSourceTopicsForItem.add(regeneratedDraft.sourceRssTopic.trim())
            }

            const evaluation = await evaluateDraftCandidate({
              candidate: regeneratedDraft.draft,
              recentCoverage: dynamicCoverage,
              acceptedDrafts,
            })

            attemptedDrafts.push(regeneratedDraft.draft)

            const nonOverlappingToneFallback =
              GENERATION_REDRAFT_ACCEPT_NON_OVERLAP &&
              !evaluation.repetition.overlaps &&
              evaluation.reason.startsWith('tone:')
            if (evaluation.accepted || nonOverlappingToneFallback) {
              selectedDraft = regeneratedDraft.draft
              selectedTopicHint = regeneratedDraft.sourceRssTopic ?? seedTopicHint
              selectedEvaluation = evaluation
              if (!evaluation.accepted && nonOverlappingToneFallback) {
                console.warn(
                  `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} using non-overlap fallback draft after repetition (tone gate bypassed)`,
                )
              }
              break
            }

            if (evaluation.repetition.matchedReference) {
              dynamicCoverage.push({
                headline: evaluation.repetition.matchedReference.slice(0, 140),
                excerpt: evaluation.repetition.matchedReference.slice(0, 280),
              })
            }
            console.warn(
              `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} redraft pivot ${pivotAttempt}/${GENERATION_REDRAFT_ATTEMPTS_PER_FAILURE} rejected (${evaluation.reason})`,
            )
          }

          if (!selectedDraft || !selectedEvaluation) {
            console.warn(
              `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} no viable pivot draft found after repetition`,
            )
            continue
          }

          seedDraft = selectedDraft
          seedTopicHint = selectedTopicHint
          await payload.update({
            collection: 'generation-job-items',
            id: body.itemId,
            data: {
              headline: seedDraft.headline,
              subheadline: seedDraft.subheadline ?? undefined,
              excerpt: seedDraft.excerpt ?? undefined,
              sourceRssTopic: seedTopicHint ?? undefined,
              draftEvaluation: selectedEvaluation,
              error: undefined,
            },
          })
          console.log(
            `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} redraft accepted after repetition | "${seedDraft.headline.slice(0, 120)}"`,
          )
        } catch (redraftError) {
          const redraftMessage =
            redraftError instanceof Error ? redraftError.message : String(redraftError)
          console.warn(
            `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} redraft after repetition failed (${redraftMessage})`,
          )
        }
      }
    }
    if (!generated) {
      if (lastError instanceof Error) throw lastError
      throw new Error('Generation failed without output')
    }

    let finalGenerated = generated
    const categoriesDocs = categoriesRes.docs as Array<{
      id: string | number
      slug: string
      order?: number
    }>
    let categoryDoc = categoriesDocs.find((c) => c.slug === finalGenerated.categorySlug)
    if (!categoryDoc) {
      const categoryName = slugToCategoryName(finalGenerated.categorySlug)
      try {
        const maxOrder = Math.max(...categoriesDocs.map((c) => c.order ?? 0), 0)
        const createdCategory = await payload.create({
          collection: 'categories',
          data: {
            name: categoryName,
            slug: finalGenerated.categorySlug,
            order: maxOrder + 1,
          },
        })
        categoryDoc = { id: createdCategory.id, slug: finalGenerated.categorySlug }
      } catch {
        const existingCategory = await payload.find({
          collection: 'categories',
          where: { slug: { equals: finalGenerated.categorySlug } },
          limit: 1,
        })
        const found = existingCategory.docs[0] as { id: string | number; slug: string } | undefined
        if (!found) throw new Error(`Failed to resolve category "${finalGenerated.categorySlug}"`)
        categoryDoc = found
      }
    }

    let authorDoc: AuthorRef | undefined = authorsDocs.find(
      (a) => a.slug === finalGenerated.authorSlug,
    )
    if (!authorDoc && finalGenerated.newAuthorName) {
      const allowNewAuthor =
        authorsDocs.length < GENERATION_NEW_AUTHOR_POOL_THRESHOLD ||
        Math.random() < GENERATION_NEW_AUTHOR_PROBABILITY

      if (!allowNewAuthor) {
        const fallbackAuthor = authorContextDocs[0] ?? authorsDocs[0]
        if (fallbackAuthor) {
          console.log(
            `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} forcing existing author reuse (pool=${authorsDocs.length}, requested="${finalGenerated.authorSlug}")`,
          )
          finalGenerated = {
            ...finalGenerated,
            authorSlug: fallbackAuthor.slug,
            newAuthorName: null,
            newAuthorTitle: null,
            newAuthorBio: null,
          }
          authorDoc = fallbackAuthor
        }
      }
    }

    if (!authorDoc && finalGenerated.newAuthorName) {
      try {
        const createdAuthor = await payload.create({
          collection: 'authors',
          data: {
            name: finalGenerated.newAuthorName,
            slug: finalGenerated.authorSlug,
            title: finalGenerated.newAuthorTitle ?? undefined,
            bio: finalGenerated.newAuthorBio ?? undefined,
          },
        })
        authorDoc = { id: createdAuthor.id, slug: finalGenerated.authorSlug }
      } catch {
        const existingAuthor = await payload.find({
          collection: 'authors',
          where: { slug: { equals: finalGenerated.authorSlug } },
          limit: 1,
        })
        const found = existingAuthor.docs[0] as { id: string | number; slug: string } | undefined
        if (!found) throw new Error(`Failed to resolve author "${finalGenerated.authorSlug}"`)
        authorDoc = found
      }
    }
    if (!authorDoc) {
      const fallbackAuthor = authorContextDocs[0] ?? authorsDocs[0]
      if (!fallbackAuthor) {
        throw new Error(
          `Author slug "${finalGenerated.authorSlug}" not found and no fallback author available`,
        )
      }
      console.warn(
        `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} author slug "${finalGenerated.authorSlug}" missing; falling back to "${fallbackAuthor.slug}"`,
      )
      authorDoc = fallbackAuthor
    }
    const resolvedAuthorDoc = authorDoc

    const sanitizedEditorConfig = await sanitizeServerEditorConfig(
      defaultEditorConfig,
      payload.config,
    )
    const lexical = convertMarkdownToLexical({
      editorConfig: sanitizedEditorConfig,
      markdown: finalGenerated.bodyMarkdown,
    })

    const slug = `${slugify(finalGenerated.headline)}-${Date.now()}-${body.itemId}`
    const imagePrompt =
      typeof finalGenerated.imagePrompt === 'string' ? finalGenerated.imagePrompt : ''
    const normalizedSubheadline =
      normalizeOptionalSubheadlineForStorage(finalGenerated.subheadline) ??
      buildSummaryFromMarkdownContent(finalGenerated.bodyMarkdown, 220)
    const normalizedExcerpt =
      normalizeOptionalExcerptForStorage(finalGenerated.excerpt, 300) ??
      buildSummaryFromMarkdownContent(finalGenerated.bodyMarkdown, 300)
    let featuredImageUrl: string | undefined
    let instagramPublishArgs: {
      slug: string
      headline: string
      excerpt: string | null
      featuredImageUrl: string
    } | null = null

    const createdArticle = await payload.create({
      collection: 'articles',
      data: {
        headline: finalGenerated.headline,
        subheadline: normalizedSubheadline,
        slug,
        featuredImageUrl: undefined,
        imageCaption: finalGenerated.imageCaption ?? undefined,
        content: lexical,
        excerpt: normalizedExcerpt,
        category: categoryDoc.id,
        author: resolvedAuthorDoc.id,
        publishedAt: body.publish ? new Date().toISOString() : undefined,
        status: body.publish ? 'published' : 'draft',
        isFeatured: finalGenerated.isFeatured,
        isHeadline: body.setAsHeadline ? finalGenerated.isHeadline : false,
        layout: finalGenerated.layout,
        sourceRssTopic: usedRssTopic ?? seedTopicHint ?? undefined,
        canonicalSourceAuthor: finalGenerated.canonicalSourceAuthor ?? undefined,
        canonicalSourceStory: finalGenerated.canonicalSourceStory ?? undefined,
      },
    })

    if (imagePrompt.length > 0) {
      try {
        console.log(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} generating image (post-save)`,
        )
        const uploaded = await generateAndUploadImage({
          prompt: imagePrompt,
          fileBaseName: slug,
        })
        featuredImageUrl = uploaded.publicUrl
        await payload.update({
          collection: 'articles',
          id: createdArticle.id,
          data: {
            featuredImageUrl,
          },
        })
        if (body.publish && featuredImageUrl) {
          instagramPublishArgs = {
            slug,
            headline: finalGenerated.headline,
            excerpt: normalizedExcerpt ?? null,
            featuredImageUrl,
          }
        }
        console.log(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} image uploaded`,
        )
      } catch (imageError) {
        console.warn(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} image generation failed post-save`,
          imageError,
        )
      }
    }

    await payload.update({
      collection: 'generation-job-items',
      id: body.itemId,
      data: {
        status: 'completed',
        article: createdArticle.id,
        articleSlug: slug,
        categorySlug: finalGenerated.categorySlug,
        sourceRssTopic: usedRssTopic ?? seedTopicHint ?? undefined,
        completedAt: new Date().toISOString(),
      },
    })
    console.log(
      `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} completed | slug=${slug} category=${finalGenerated.categorySlug} rss=${usedRssTopic ?? seedTopicHint ?? 'none'}`,
    )

    try {
      await tryFinalizeGenerationJob({
        baseUrl,
        tokenForInternalCalls,
        jobId: body.jobId,
      })
    } catch (finalizeError) {
      console.error(
        `${LOG_PREFIX} Finalization attempt failed after item completion for job ${String(body.jobId)}`,
        finalizeError,
      )
    }

    if (instagramPublishArgs) {
      try {
        const instagramResult = await maybePublishInstagram(instagramPublishArgs)
        console.log(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} instagram post status | attempted=${instagramResult.attempted} skipped=${instagramResult.skipped} hook=${instagramResult.queuedByArticleHook} reason=${instagramResult.reason ?? 'ok'}`,
        )
      } catch (instagramError) {
        console.warn(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} instagram publish failed`,
          instagramError,
        )
      }
    }

    return NextResponse.json({
      ok: true,
      created: {
        id: createdArticle.id,
        slug,
        featuredImageUrl: featuredImageUrl ?? null,
        categorySlug: finalGenerated.categorySlug,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process item'
    console.error(
      `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} failed (${message})`,
      error,
    )
    await payload.update({
      collection: 'generation-job-items',
      id: body.itemId,
      data: {
        status: 'failed',
        error: message,
        completedAt: new Date().toISOString(),
      },
    })
    try {
      await tryFinalizeGenerationJob({
        baseUrl,
        tokenForInternalCalls,
        jobId: body.jobId,
      })
    } catch (finalizeError) {
      console.error(
        `${LOG_PREFIX} Finalization attempt failed after item failure for job ${String(body.jobId)}`,
        finalizeError,
      )
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
