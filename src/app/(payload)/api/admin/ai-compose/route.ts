import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  convertMarkdownToLexical,
  defaultEditorConfig,
  sanitizeServerEditorConfig,
} from '@payloadcms/richtext-lexical'
import { getPayload } from '@/lib/payload'
import { fetchRssTopics } from '@/lib/rss/fetchRssTopics'
import {
  extractHeadlinePatterns,
  generateArticle,
  shouldIncludeHumorPerspectiveMethod,
  summarizeRecentArticlesForBlacklist,
  type GeneratedArticle,
} from '@/lib/generation/generateArticle'
import { getOrComputeBlacklistSummary } from '@/lib/generation/blacklistSummaryCache'
import { evaluateDraftCandidate, generateDraftCandidate } from '@/lib/generation/draftPipeline'
import { generateAndUploadImage } from '@/lib/images/generateAndUploadImage'
import { normalizeExcerptForStorage } from '@/lib/text/excerptQuality'
import { normalizeOptionalSubheadlineForStorage } from '@/lib/text/subheadline'
import { generateAuthors } from '@/lib/generation/generateAuthors'
import { CANONICAL_SITE_URL } from '@/lib/getBaseUrl'
import { createAndUploadInstagramImage } from '@/lib/instagram/createInstagramImage'
import { postToInstagram } from '@/lib/instagram/postToInstagram'
import type { DraftCandidate, RecentCoverageItem, SlotConfig } from '@/lib/generation/pipelineTypes'

export const maxDuration = 300

const LOG_PREFIX = '[ADMIN-AI-COMPOSE]'
const LOG_ENABLED = (process.env.ADMIN_AI_COMPOSE_LOGS ?? 'true') !== 'false'
const storyDescriptionEnv = Number(process.env.ADMIN_AI_COMPOSE_STORY_MAX ?? 2000)
const STORY_DESCRIPTION_MAX =
  Number.isFinite(storyDescriptionEnv) && storyDescriptionEnv >= 300
    ? Math.trunc(storyDescriptionEnv)
    : 2000
const SOURCE_RSS_TOPIC_MAX = 300
const REQUEST_ID_SLICE = 8

const MIN_AUTHOR_POOL = Number(process.env.MIN_AUTHOR_POOL ?? 8)
const MAX_NEW_AUTHORS_PER_RUN = Number(process.env.MAX_NEW_AUTHORS_PER_RUN ?? 3)

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

const DEFAULT_GENERATION_OPTIONS = {
  useRandomModes: false,
  includeBerlinThemes: true,
  useRssTopic: true,
  forceDrugsTechno: false,
  forceStartup: false,
  forceOpinion: false,
  strictTopicFocus: true,
} as const

const BaseRequestSchema = z.object({
  action: z.enum(['getTopics', 'generateDraft', 'generateArticle', 'generateImage', 'publish']),
})

const DraftSchema = z.object({
  headline: z.string().min(10).max(140),
  subheadline: z.string().max(220).nullable().optional(),
  excerpt: z.string().max(300).nullable().optional(),
})

const GenerationOptionsSchema = z
  .object({
    useRandomModes: z.boolean().default(DEFAULT_GENERATION_OPTIONS.useRandomModes),
    includeBerlinThemes: z.boolean().default(DEFAULT_GENERATION_OPTIONS.includeBerlinThemes),
    useRssTopic: z.boolean().default(DEFAULT_GENERATION_OPTIONS.useRssTopic),
    forceDrugsTechno: z.boolean().default(DEFAULT_GENERATION_OPTIONS.forceDrugsTechno),
    forceStartup: z.boolean().default(DEFAULT_GENERATION_OPTIONS.forceStartup),
    forceOpinion: z.boolean().default(DEFAULT_GENERATION_OPTIONS.forceOpinion),
    strictTopicFocus: z.boolean().default(DEFAULT_GENERATION_OPTIONS.strictTopicFocus),
  })
  .superRefine((value, ctx) => {
    if (value.forceDrugsTechno && value.forceStartup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select either drugs/techno or startup mode, not both at once.',
        path: ['forceDrugsTechno'],
      })
    }
  })

const GenerateDraftRequestSchema = z
  .object({
    action: z.literal('generateDraft'),
    rssTopic: z.string().max(300).optional(),
    storyDescription: z.string().max(STORY_DESCRIPTION_MAX).optional(),
    revisionInstructions: z.string().max(1200).optional(),
    previousDrafts: z.array(DraftSchema).max(15).default([]),
    options: GenerationOptionsSchema.default(DEFAULT_GENERATION_OPTIONS),
  })
  .superRefine((value, ctx) => {
    const hasTopic = value.options.useRssTopic && Boolean(value.rssTopic?.trim())
    const hasDescription = Boolean(value.storyDescription?.trim())
    if (!hasTopic && !hasDescription) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either an RSS topic or a story description.',
        path: ['rssTopic'],
      })
    }
  })

const GenerateArticleRequestSchema = z
  .object({
    action: z.literal('generateArticle'),
    approvedDraft: DraftSchema,
    sourceRssTopic: z.string().max(STORY_DESCRIPTION_MAX).nullable().optional(),
    rssTopic: z.string().max(300).optional(),
    storyDescription: z.string().max(STORY_DESCRIPTION_MAX).optional(),
    revisionInstructions: z.string().max(1500).optional(),
    useHumorPerspectiveMethod: z.boolean().optional(),
    options: GenerationOptionsSchema.default(DEFAULT_GENERATION_OPTIONS),
  })
  .superRefine((value, ctx) => {
    const hasTopic =
      Boolean(value.sourceRssTopic?.trim()) ||
      (value.options.useRssTopic && Boolean(value.rssTopic?.trim())) ||
      Boolean(value.storyDescription?.trim())
    if (!hasTopic) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A topic or story description is required to generate an article.',
        path: ['rssTopic'],
      })
    }
  })

const GenerateImageRequestSchema = z.object({
  action: z.literal('generateImage'),
  headline: z.string().min(10).max(140),
  imagePrompt: z.string().min(10).max(1200),
  revisionInstructions: z.string().max(1200).optional(),
})

const PublishArticleSchema = z.object({
  headline: z.string().min(10).max(140),
  subheadline: z.string().max(220).nullable().optional(),
  excerpt: z.string().max(300).nullable().optional(),
  bodyMarkdown: z.string().min(1),
  categorySlug: z.string().min(1),
  authorSlug: z.string().min(1),
  newAuthorName: z.string().max(60).nullable().optional(),
  newAuthorTitle: z.string().max(100).nullable().optional(),
  newAuthorBio: z.string().max(500).nullable().optional(),
  layout: z.enum(['standard', 'wide', 'opinion']),
  isFeatured: z.boolean(),
  isHeadline: z.boolean(),
  imageCaption: z.string().max(160).nullable().optional(),
  sourceRssTopic: z.string().max(STORY_DESCRIPTION_MAX).nullable().optional(),
  canonicalSourceAuthor: z.string().max(120).nullable().optional(),
  canonicalSourceStory: z.string().max(220).nullable().optional(),
})

const PublishRequestSchema = z
  .object({
    action: z.literal('publish'),
    article: PublishArticleSchema,
    featuredImageUrl: z.string().url(),
    sourceRssTopic: z.string().max(STORY_DESCRIPTION_MAX).nullable().optional(),
    rssTopic: z.string().max(300).optional(),
    storyDescription: z.string().max(STORY_DESCRIPTION_MAX).optional(),
    setAsHeadline: z.boolean().default(false),
    manualArticle: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.manualArticle && value.article.bodyMarkdown.trim().length < 200) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Too small: expected string to have >=200 characters',
        path: ['article', 'bodyMarkdown'],
      })
    }
  })

type CategoryDoc = {
  id: string | number
  slug: string
  name: string
  order?: number
}

type AuthorDoc = {
  id: string | number
  slug: string
  name: string
  title?: string
  bio?: string
}

type RecentArticleDoc = {
  headline?: string
  excerpt?: string
  canonicalSourceAuthor?: string
  canonicalSourceStory?: string
  content?: unknown
}

type PayloadInstance = NonNullable<Awaited<ReturnType<typeof getPayload>>>
type GenerationOptions = z.infer<typeof GenerationOptionsSchema>

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function buildRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 2 + REQUEST_ID_SLICE)}`
}

function logInfo(requestId: string, message: string, meta?: Record<string, unknown>): void {
  if (!LOG_ENABLED) return
  if (meta) {
    console.log(`${LOG_PREFIX} [${requestId}] ${message}`, meta)
    return
  }
  console.log(`${LOG_PREFIX} [${requestId}] ${message}`)
}

function logWarn(requestId: string, message: string, meta?: Record<string, unknown>): void {
  if (!LOG_ENABLED) return
  if (meta) {
    console.warn(`${LOG_PREFIX} [${requestId}] ${message}`, meta)
    return
  }
  console.warn(`${LOG_PREFIX} [${requestId}] ${message}`)
}

function logError(
  requestId: string,
  message: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  if (!LOG_ENABLED) return
  if (meta) {
    console.error(`${LOG_PREFIX} [${requestId}] ${message}`, meta, error)
    return
  }
  console.error(`${LOG_PREFIX} [${requestId}] ${message}`, error)
}

function formatValidationError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    return `${path}: ${issue.message}`
  })
  return issues.join(' | ')
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

function normalizeSourceRssTopic(input?: string | null): string | null {
  const trimmed = input?.trim() ?? ''
  if (!trimmed) return null
  if (trimmed.length <= SOURCE_RSS_TOPIC_MAX) return trimmed
  return trimmed.slice(0, SOURCE_RSS_TOPIC_MAX).trim()
}

function extractTextFromLexical(content: unknown): string {
  if (!content || typeof content !== 'object') return ''

  const root = content as { root?: { children?: unknown[] } }
  if (!root.root?.children) return ''

  const extractFromNodes = (nodes: unknown[]): string => {
    const texts: string[] = []
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const n = node as { type?: string; text?: string; children?: unknown[] }
      if (n.type === 'text' && typeof n.text === 'string') {
        texts.push(n.text)
      }
      if (Array.isArray(n.children)) {
        texts.push(extractFromNodes(n.children))
      }
    }
    return texts.join(' ')
  }

  return extractFromNodes(root.root.children).replace(/\s+/g, ' ').trim()
}

function getTopicInput(args: {
  rssTopic?: string
  storyDescription?: string
  fallback?: string | null
  options: GenerationOptions
}): { topicHint: string | null; topicSummary: string } {
  const rssTopic = args.rssTopic?.trim() || ''
  const storyDescription = args.storyDescription?.trim() || ''
  const fallback = args.fallback?.trim() || ''

  const topicLines: Array<{ source: 'manual' | 'rss' | 'hint'; value: string }> = []
  if (storyDescription.length > 0) {
    topicLines.push({ source: 'manual', value: storyDescription })
  }
  if (args.options.useRssTopic && rssTopic.length > 0) {
    topicLines.push({ source: 'rss', value: rssTopic })
  }
  if (topicLines.length === 0 && fallback.length > 0) {
    topicLines.push({ source: 'hint', value: fallback })
  }

  if (topicLines.length === 0) return { topicHint: null, topicSummary: '' }

  return {
    topicHint: topicLines[0]?.value ?? null,
    topicSummary: topicLines.map((entry) => `- [${entry.source}] ${entry.value}`).join('\n'),
  }
}

async function isAuthenticatedAdminRequest(request: Request): Promise<boolean> {
  const meUrl = new URL('/api/users/me', request.url)
  const headers = new Headers()

  const cookie = request.headers.get('cookie')
  if (cookie) headers.set('cookie', cookie)

  const authorization = request.headers.get('authorization')
  if (authorization) headers.set('authorization', authorization)

  const response = await fetch(meUrl, {
    method: 'GET',
    headers,
    cache: 'no-store',
  })

  if (!response.ok) return false

  const json = (await response.json().catch(() => null)) as {
    user?: { id?: string | number }
  } | null

  return Boolean(
    json?.user && (typeof json.user.id === 'string' || typeof json.user.id === 'number'),
  )
}

async function ensureCategoriesAndAuthors(payload: PayloadInstance) {
  let categoriesRes = await payload.find({
    collection: 'categories',
    limit: 200,
    sort: 'order',
    depth: 0,
  })

  if ((categoriesRes.totalDocs ?? 0) === 0) {
    for (const cat of BASELINE_CATEGORIES) {
      await payload.create({ collection: 'categories', data: cat })
    }
    categoriesRes = await payload.find({
      collection: 'categories',
      limit: 200,
      sort: 'order',
      depth: 0,
    })
  }

  let authorsRes = await payload.find({
    collection: 'authors',
    limit: 300,
    sort: 'name',
    depth: 0,
  })

  const authorsCount = authorsRes.totalDocs ?? 0
  if (authorsCount < MIN_AUTHOR_POOL) {
    const toCreate = Math.min(MAX_NEW_AUTHORS_PER_RUN, MIN_AUTHOR_POOL - authorsCount)
    if (toCreate > 0) {
      const generatedAuthors = await generateAuthors({ count: toCreate })
      for (const author of generatedAuthors) {
        try {
          await payload.create({ collection: 'authors', data: author })
        } catch {
          // Ignore duplicates and continue.
        }
      }
      authorsRes = await payload.find({
        collection: 'authors',
        limit: 300,
        sort: 'name',
        depth: 0,
      })
    }
  }

  const categories = normalizeArray<CategoryDoc>(categoriesRes.docs).filter(
    (doc): doc is CategoryDoc =>
      doc != null && typeof doc.slug === 'string' && typeof doc.name === 'string' && doc.id != null,
  )

  const authors = normalizeArray<AuthorDoc>(authorsRes.docs).filter(
    (doc): doc is AuthorDoc =>
      doc != null && typeof doc.slug === 'string' && typeof doc.name === 'string' && doc.id != null,
  )

  return { categories, authors }
}

async function loadRecentContext(payload: PayloadInstance) {
  const recentArticlesRes = await payload.find({
    collection: 'articles',
    where: { status: { equals: 'published' } },
    limit: 50,
    sort: '-publishedAt',
    depth: 0,
  })

  const recentDocs = normalizeArray<RecentArticleDoc>(recentArticlesRes.docs)
  const recentCoverage: RecentCoverageItem[] = recentDocs
    .map((doc) => {
      const headline = typeof doc.headline === 'string' ? doc.headline.trim() : ''
      if (!headline) return null
      const excerpt = typeof doc.excerpt === 'string' ? doc.excerpt.trim() : ''
      return { headline, excerpt }
    })
    .filter((item): item is RecentCoverageItem => item !== null)

  const recentArticleTitles = recentCoverage.map((entry) => entry.headline)
  const recentArticleExcerpts = recentCoverage.map((entry) => entry.excerpt)

  const recentCanonicalStoryReferences = recentDocs
    .map((doc) => ({
      author: doc.canonicalSourceAuthor?.trim() ?? '',
      story: doc.canonicalSourceStory?.trim() ?? '',
    }))
    .filter((entry) => entry.author.length > 0 && entry.story.length > 0)
    .slice(0, 20)

  const maxRecentForAnalysis = 20
  const titlesForAnalysis = recentArticleTitles.slice(0, maxRecentForAnalysis)
  const excerptsForAnalysis = recentArticleExcerpts.slice(0, maxRecentForAnalysis)

  const blacklistCache = await getOrComputeBlacklistSummary({
    payload,
    titles: titlesForAnalysis,
    excerpts: excerptsForAnalysis,
    computeSummary: () =>
      summarizeRecentArticlesForBlacklist({
        titles: titlesForAnalysis,
        excerpts: excerptsForAnalysis,
      }),
  })

  let latestArticleContentSample: string | undefined
  const latest = recentDocs[0]
  if (latest?.content) {
    const fullText = extractTextFromLexical(latest.content)
    const halfLength = Math.min(Math.floor(fullText.length / 2), 1500)
    if (halfLength > 100) {
      latestArticleContentSample = `${fullText.slice(0, halfLength)}...`
    }
  }

  return {
    recentCoverage,
    recentArticleTitles,
    recentArticleExcerpts,
    recentCanonicalStoryReferences,
    recentHeadlinePatterns: Array.from(new Set(extractHeadlinePatterns(recentArticleTitles))),
    blacklistSummary: blacklistCache.summary,
    latestArticleContentSample,
  }
}

async function resolveCategory(payload: PayloadInstance, categorySlug: string) {
  const categorySlugTrimmed = categorySlug.trim()

  const existing = await payload.find({
    collection: 'categories',
    where: { slug: { equals: categorySlugTrimmed } },
    limit: 1,
    depth: 0,
  })

  const found = normalizeArray<CategoryDoc>(existing.docs)[0]
  if (found?.id != null) {
    return { id: found.id, slug: found.slug }
  }

  const categoriesRes = await payload.find({
    collection: 'categories',
    limit: 200,
    sort: 'order',
    depth: 0,
  })
  const categories = normalizeArray<CategoryDoc>(categoriesRes.docs)
  const maxOrder = Math.max(...categories.map((c) => c.order ?? 0), 0)

  try {
    const created = await payload.create({
      collection: 'categories',
      data: {
        name: slugToCategoryName(categorySlugTrimmed),
        slug: categorySlugTrimmed,
        order: maxOrder + 1,
      },
    })

    return { id: created.id as string | number, slug: categorySlugTrimmed }
  } catch {
    const retry = await payload.find({
      collection: 'categories',
      where: { slug: { equals: categorySlugTrimmed } },
      limit: 1,
      depth: 0,
    })
    const retryFound = normalizeArray<CategoryDoc>(retry.docs)[0]
    if (!retryFound?.id) {
      throw new Error(`Failed to resolve category "${categorySlugTrimmed}"`)
    }
    return { id: retryFound.id, slug: retryFound.slug }
  }
}

async function resolveAuthor(
  payload: PayloadInstance,
  article: z.infer<typeof PublishArticleSchema>,
) {
  const authorSlug = article.authorSlug.trim()

  const existing = await payload.find({
    collection: 'authors',
    where: { slug: { equals: authorSlug } },
    limit: 1,
    depth: 0,
  })

  const found = normalizeArray<AuthorDoc>(existing.docs)[0]
  if (found?.id != null) {
    return { id: found.id as string | number, slug: found.slug }
  }

  if (!article.newAuthorName?.trim()) {
    throw new Error(`Author slug "${authorSlug}" not found and no new author name provided`)
  }

  try {
    const created = await payload.create({
      collection: 'authors',
      data: {
        name: article.newAuthorName.trim(),
        slug: authorSlug,
        title: article.newAuthorTitle?.trim() || undefined,
        bio: article.newAuthorBio?.trim() || undefined,
      },
    })

    return { id: created.id as string | number, slug: authorSlug }
  } catch {
    const retry = await payload.find({
      collection: 'authors',
      where: { slug: { equals: authorSlug } },
      limit: 1,
      depth: 0,
    })
    const retryFound = normalizeArray<AuthorDoc>(retry.docs)[0]
    if (!retryFound?.id) {
      throw new Error(`Failed to resolve author "${authorSlug}"`)
    }
    return { id: retryFound.id as string | number, slug: retryFound.slug }
  }
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

  if (process.env.INSTAGRAM_ENABLED !== 'true') {
    return {
      attempted: false,
      queuedByArticleHook: false,
      skipped: true,
      reason: 'INSTAGRAM_ENABLED is not true',
    }
  }

  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim()
  const igUserId = process.env.INSTAGRAM_IG_USER_ID?.trim()
  if (!accessToken || !igUserId) {
    return {
      attempted: false,
      queuedByArticleHook: false,
      skipped: true,
      reason: 'Missing INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_IG_USER_ID',
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

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = buildRequestId()
  const startedAt = Date.now()
  logInfo(requestId, 'Incoming request')

  const isAuthorized = await isAuthenticatedAdminRequest(request)
  if (!isAuthorized) {
    logWarn(requestId, 'Unauthorized request')
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  logInfo(requestId, 'Authorization passed')
  const payload = await getPayload()
  if (!payload) {
    logWarn(requestId, 'Payload unavailable')
    return NextResponse.json({ ok: false, error: 'Payload unavailable' }, { status: 503 })
  }
  const payloadClient: PayloadInstance = payload

  let json: unknown
  try {
    json = (await request.json()) as unknown
  } catch {
    logWarn(requestId, 'Invalid JSON body')
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  let baseBody: z.infer<typeof BaseRequestSchema>
  try {
    baseBody = BaseRequestSchema.parse(json)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formatted = formatValidationError(error)
      logWarn(requestId, 'Base validation failed', { error: formatted })
      return NextResponse.json({ ok: false, error: formatted }, { status: 400 })
    }
    logWarn(requestId, 'Invalid action payload', {
      error: error instanceof Error ? error.message : 'unknown',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Invalid action' },
      { status: 400 },
    )
  }

  logInfo(requestId, `Parsed action "${baseBody.action}"`)
  try {
    switch (baseBody.action) {
      case 'getTopics': {
        const actionStart = Date.now()
        logInfo(requestId, 'getTopics: fetching RSS topics')
        const topics = await fetchRssTopics()
        logInfo(requestId, 'getTopics: done', {
          topicCount: topics.topics.length,
          ms: Date.now() - actionStart,
        })
        return NextResponse.json({ ok: true, topics: topics.topics })
      }

      case 'generateDraft': {
        const body = GenerateDraftRequestSchema.parse(json)
        const actionStart = Date.now()
        const options = body.options as GenerationOptions
        const { topicHint, topicSummary } = getTopicInput({
          rssTopic: body.rssTopic,
          storyDescription: body.storyDescription,
          options,
        })
        logInfo(requestId, 'generateDraft: request validated', {
          hasRssTopic: Boolean(body.rssTopic?.trim()),
          storyDescriptionLength: body.storyDescription?.trim().length ?? 0,
          revisionLength: body.revisionInstructions?.trim().length ?? 0,
          previousDrafts: body.previousDrafts.length,
          options,
        })

        if (!topicHint || !topicSummary) {
          return NextResponse.json(
            { ok: false, error: 'Provide a topic or story description.' },
            { status: 400 },
          )
        }

        const recent = await loadRecentContext(payloadClient)
        const forceOpinion = options.forceOpinion
        const forceDrugsTechno = !forceOpinion && options.forceDrugsTechno
        const forceStartup = !forceOpinion && options.forceStartup
        const useHumorPerspectiveMethod = shouldIncludeHumorPerspectiveMethod()
        const slot: SlotConfig = {
          forceDrugsTechno: forceDrugsTechno ? true : options.useRandomModes ? undefined : false,
          forceStartup: forceStartup ? true : options.useRandomModes ? undefined : false,
          forceRss: options.useRssTopic && Boolean(body.rssTopic?.trim()),
          forceOpinion,
          includeTopics: true,
          useHumorPerspectiveMethod,
        }

        const acceptedDrafts: DraftCandidate[] = body.previousDrafts.map((draft) => ({
          headline: draft.headline,
          subheadline: draft.subheadline ?? null,
          excerpt: draft.excerpt ?? null,
        }))

        const result = await generateDraftCandidate({
          slot,
          topicSummary,
          recentCoverage: recent.recentCoverage,
          blacklistSummary: recent.blacklistSummary,
          acceptedDrafts,
          editorDirection: body.revisionInstructions,
          includeBerlinThemes: options.includeBerlinThemes,
          useRandomModes: options.useRandomModes,
          strictTopicFocus: options.strictTopicFocus,
        })

        const evaluation = await evaluateDraftCandidate({
          candidate: result.draft,
          recentCoverage: recent.recentCoverage,
          acceptedDrafts,
        })

        const normalizedSourceRssTopic = normalizeSourceRssTopic(result.sourceRssTopic)
        logInfo(requestId, 'generateDraft: completed', {
          sourceRssTopic: normalizedSourceRssTopic,
          sourceRssTopicWasTrimmed:
            Boolean(result.sourceRssTopic) && result.sourceRssTopic !== normalizedSourceRssTopic,
          acceptedByAutoEvaluation: evaluation.accepted,
          ms: Date.now() - actionStart,
        })
        return NextResponse.json({
          ok: true,
          topicHint,
          draft: result.draft,
          sourceRssTopic: normalizedSourceRssTopic,
          evaluation,
          useHumorPerspectiveMethod,
        })
      }

      case 'generateArticle': {
        const body = GenerateArticleRequestSchema.parse(json)
        const actionStart = Date.now()
        const { categories, authors } = await ensureCategoriesAndAuthors(payloadClient)
        const options = body.options as GenerationOptions
        logInfo(requestId, 'generateArticle: request validated', {
          draftHeadlineLength: body.approvedDraft.headline.length,
          hasRssTopic: Boolean(body.rssTopic?.trim() || body.sourceRssTopic?.trim()),
          storyDescriptionLength: body.storyDescription?.trim().length ?? 0,
          revisionLength: body.revisionInstructions?.trim().length ?? 0,
          options,
        })

        if (categories.length === 0 || authors.length === 0) {
          return NextResponse.json(
            { ok: false, error: 'Need at least one category and one author to generate.' },
            { status: 400 },
          )
        }

        const recent = await loadRecentContext(payloadClient)
        const normalizedSourceRssTopic = normalizeSourceRssTopic(body.sourceRssTopic)
        const { topicHint, topicSummary } = getTopicInput({
          rssTopic: body.rssTopic,
          storyDescription: body.storyDescription,
          fallback: normalizedSourceRssTopic,
          options,
        })

        if (!topicHint || !topicSummary) {
          return NextResponse.json(
            { ok: false, error: 'Provide a topic or story description.' },
            { status: 400 },
          )
        }

        const forceOpinion = options.forceOpinion
        const forceDrugsTechno = !forceOpinion && options.forceDrugsTechno
        const forceStartup = !forceOpinion && options.forceStartup
        const hasRssInput =
          options.useRssTopic && Boolean(body.rssTopic?.trim() || normalizedSourceRssTopic?.trim())
        const hasManualInput = Boolean(body.storyDescription?.trim())
        const useHumorPerspectiveMethod = shouldIncludeHumorPerspectiveMethod(
          body.useHumorPerspectiveMethod,
        )
        const generated = await generateArticle({
          categories: categories.map((category) => ({
            slug: category.slug,
            name: category.name,
          })),
          authors: authors.map((author) => ({
            slug: author.slug,
            name: author.name,
            title: author.title,
            bio: author.bio,
          })),
          topicSummary,
          includeTopics: hasRssInput || hasManualInput,
          recentArticleTitles: recent.recentArticleTitles.slice(0, 40),
          recentArticleExcerpts: recent.recentArticleExcerpts.slice(0, 40),
          recentCanonicalStoryReferences: recent.recentCanonicalStoryReferences,
          precomputedBlacklistSummary: recent.blacklistSummary,
          recentHeadlinePatterns: recent.recentHeadlinePatterns,
          latestArticleContentSample: recent.latestArticleContentSample,
          forceRss: hasRssInput,
          forceOpinion,
          useHumorPerspectiveMethod,
          forceDrugsTechno: forceDrugsTechno ? true : options.useRandomModes ? undefined : false,
          forceStartup: forceStartup ? true : options.useRandomModes ? undefined : false,
          seedDraft: {
            headline: body.approvedDraft.headline,
            subheadline: body.approvedDraft.subheadline ?? null,
            excerpt: body.approvedDraft.excerpt ?? null,
            topicHint,
          },
          editorDirection: body.revisionInstructions,
          manualOverrides: {
            useRandomModes: options.useRandomModes,
            includeBerlinThemes: options.includeBerlinThemes,
            strictTopicFocus: options.strictTopicFocus,
          },
        })

        logInfo(requestId, 'generateArticle: completed', {
          usedRssTopic: generated.usedRssTopic ?? null,
          categorySlug: generated.article.categorySlug,
          authorSlug: generated.article.authorSlug,
          bodyLength: generated.article.bodyMarkdown.length,
          ms: Date.now() - actionStart,
        })

        return NextResponse.json({
          ok: true,
          article: generated.article,
          usedRssTopic: generated.usedRssTopic,
          usedDrugsTechno: generated.usedDrugsTechno,
          usedStartup: generated.usedStartup,
        })
      }

      case 'generateImage': {
        const body = GenerateImageRequestSchema.parse(json)
        const actionStart = Date.now()
        const imagePrompt = body.imagePrompt.trim()
        const revisionInstructions = body.revisionInstructions?.trim() || ''

        logInfo(requestId, 'generateImage: request validated', {
          promptLength: imagePrompt.length,
          revisionLength: revisionInstructions.length,
        })
        const finalPrompt = revisionInstructions
          ? `${imagePrompt}\n\nEditor revision request: ${revisionInstructions}`
          : imagePrompt

        const uploaded = await generateAndUploadImage({
          prompt: finalPrompt,
          fileBaseName: slugify(body.headline),
        })

        logInfo(requestId, 'generateImage: image generated', {
          ms: Date.now() - actionStart,
        })
        return NextResponse.json({
          ok: true,
          imageUrl: uploaded.publicUrl,
          pngImageUrl: uploaded.pngPublicUrl,
          promptUsed: finalPrompt,
        })
      }

      case 'publish': {
        const body = PublishRequestSchema.parse(json)
        const actionStart = Date.now()
        const normalizedArticleSourceRssTopic = normalizeSourceRssTopic(body.article.sourceRssTopic)
        logInfo(requestId, 'publish: request validated', {
          headlineLength: body.article.headline.length,
          bodyLength: body.article.bodyMarkdown.length,
          manualArticle: body.manualArticle,
          hasImageUrl: Boolean(body.featuredImageUrl),
          setAsHeadline: body.setAsHeadline,
        })
        const article: GeneratedArticle = {
          ...body.article,
          subheadline: body.article.subheadline ?? null,
          excerpt: body.article.excerpt ?? null,
          newAuthorName: body.article.newAuthorName ?? null,
          newAuthorTitle: body.article.newAuthorTitle ?? null,
          newAuthorBio: body.article.newAuthorBio ?? null,
          imageCaption: body.article.imageCaption ?? null,
          imagePrompt: null,
          sourceRssTopic: normalizedArticleSourceRssTopic,
          canonicalSourceAuthor: body.article.canonicalSourceAuthor ?? null,
          canonicalSourceStory: body.article.canonicalSourceStory ?? null,
        }

        const category = await resolveCategory(payloadClient, article.categorySlug)
        const author = await resolveAuthor(payloadClient, body.article)

        const sanitizedEditorConfig = await sanitizeServerEditorConfig(
          defaultEditorConfig,
          payloadClient.config,
        )

        const lexical = convertMarkdownToLexical({
          editorConfig: sanitizedEditorConfig,
          markdown: article.bodyMarkdown,
        })

        const slug = `${slugify(article.headline)}-${Date.now()}`
        const sourceTopicCandidates = [
          article.sourceRssTopic,
          normalizeSourceRssTopic(body.sourceRssTopic),
          body.rssTopic?.trim(),
          body.storyDescription?.trim(),
        ]
        const sourceRssTopic =
          sourceTopicCandidates
            .map((value) => normalizeSourceRssTopic(value))
            .find((value): value is string => typeof value === 'string' && value.length > 0) ?? null

        const created = await payloadClient.create({
          collection: 'articles',
          data: {
            headline: article.headline,
            subheadline: normalizeOptionalSubheadlineForStorage(article.subheadline),
            slug,
            featuredImageUrl: body.featuredImageUrl,
            imageCaption: article.imageCaption ?? undefined,
            content: lexical,
            excerpt:
              typeof article.excerpt === 'string'
                ? normalizeExcerptForStorage(article.excerpt, 300)
                : undefined,
            category: category.id,
            author: author.id,
            publishedAt: new Date().toISOString(),
            status: 'published',
            isFeatured: article.isFeatured,
            isHeadline: body.setAsHeadline ? article.isHeadline : false,
            layout: article.layout,
            sourceRssTopic,
            canonicalSourceAuthor: article.canonicalSourceAuthor ?? undefined,
            canonicalSourceStory: article.canonicalSourceStory ?? undefined,
          },
        })

        const pathsToRevalidate = Array.from(
          new Set(['/', '/archive', `/article/${slug}`, `/section/${category.slug}`]),
        )
        for (const path of pathsToRevalidate) {
          revalidatePath(path)
        }

        const instagramResult = await maybePublishInstagram({
          slug,
          headline: article.headline,
          excerpt: article.excerpt ?? null,
          featuredImageUrl: body.featuredImageUrl,
        })

        logInfo(requestId, 'publish: completed', {
          articleId: created.id,
          slug,
          revalidatedPaths: pathsToRevalidate.length,
          instagramAttempted: Boolean(instagramResult.attempted),
          ms: Date.now() - actionStart,
        })

        return NextResponse.json({
          ok: true,
          created: {
            id: created.id,
            slug,
            url: `/article/${slug}`,
            categorySlug: category.slug,
          },
          revalidatedPaths: pathsToRevalidate,
          instagram: instagramResult,
        })
      }

      default: {
        return NextResponse.json({ ok: false, error: 'Unsupported action' }, { status: 400 })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    if (error instanceof z.ZodError) {
      const formatted = formatValidationError(error)
      logWarn(requestId, `Action ${baseBody.action} validation failed`, {
        error: formatted,
        ms: Date.now() - startedAt,
      })
      return NextResponse.json({ ok: false, error: formatted }, { status: 400 })
    }
    logError(requestId, `Action ${baseBody.action} failed (${message})`, error, {
      ms: Date.now() - startedAt,
    })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
