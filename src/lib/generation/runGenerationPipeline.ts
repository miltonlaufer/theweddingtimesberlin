import { revalidatePath } from 'next/cache'
import { getPayload } from '@/lib/payload'
import { fetchRssTopics } from '@/lib/rss/fetchRssTopics'
import {
  extractHeadlinePatterns,
  rankRssTopicsForHumor,
  summarizeRecentArticlesForBlacklist,
} from '@/lib/generation/generateArticle'
import { getOrComputeBlacklistSummary } from '@/lib/generation/blacklistSummaryCache'
import { generateAuthors } from '@/lib/generation/generateAuthors'
import { sendPushNotifications } from '@/lib/push/sendNotifications'
import { buildInternalAuthHeaders } from '@/lib/generation/internalAuth'
import type { RecentCoverageItem, SlotConfig } from '@/lib/generation/pipelineTypes'

/******************* LOGGING ***********************/

const CRON_LOG = {
  prefix: '[CRON-GENERATE]',
  sep: '════════════════════════════════════════════════════════════════',
  step: (label: string) =>
    console.log(
      `${CRON_LOG.prefix} ${CRON_LOG.sep}\n${CRON_LOG.prefix} ${label}\n${CRON_LOG.prefix} ${CRON_LOG.sep}`,
    ),
  info: (message: string) => console.log(`${CRON_LOG.prefix} ${message}`),
  warn: (message: string) => console.warn(`${CRON_LOG.prefix} ${message}`),
}

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/******************* CONSTANTS ***********************/

const MIN_AUTHOR_POOL = Number(process.env.MIN_AUTHOR_POOL ?? 8)
const MAX_NEW_AUTHORS_PER_RUN = Number(process.env.MAX_NEW_AUTHORS_PER_RUN ?? 3)
export const ARTICLES_PER_RUN = Number(process.env.ARTICLES_PER_RUN ?? 8)
const MAX_DRAFT_RETRIES = Number(process.env.DRAFT_MAX_RETRIES ?? 2)
const FORCED_RSS_SLOTS = 2

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

function pickTwoThirds(): boolean {
  return Math.random() < 2 / 3
}

function computeSlotConfigs(
  count: number,
  hasRssTopics: boolean,
  forceOpinionFirst: boolean,
): SlotConfig[] {
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
    forceStartup: false,
    forceRss: false,
    forceOpinion: false,
    includeTopics: false,
  })

  if (hasRssTopics) {
    for (let i = 0; i < FORCED_RSS_SLOTS; i++) {
      guaranteed.push({
        forceDrugsTechno: i === 0,
        forceStartup: false,
        forceRss: true,
        forceOpinion: false,
        includeTopics: true,
      })
    }
  }

  const slots: SlotConfig[] = []
  for (let i = 0; i < count; i++) {
    if (i < guaranteed.length) {
      slots.push(guaranteed[i])
    } else {
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

function toRecentCoverageItems(docs: unknown[]): RecentCoverageItem[] {
  return docs
    .map((a) => {
      const doc = a as { headline?: string; excerpt?: string }
      const headline = typeof doc.headline === 'string' ? doc.headline.trim() : ''
      if (!headline) return null
      const excerpt = typeof doc.excerpt === 'string' ? doc.excerpt.trim() : ''
      return { headline, excerpt }
    })
    .filter((item): item is RecentCoverageItem => item !== null && item.headline.length > 0)
}

function normalizeTopicIdentity(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

async function callInternalJson<T>(params: {
  baseUrl: string
  path: string
  token: string | undefined
  body: unknown
}): Promise<{ ok: boolean; status: number; data: T | { error?: string } }> {
  const url = new URL(params.path, params.baseUrl).toString()
  const headers: HeadersInit = {
    'content-type': 'application/json',
    ...buildInternalAuthHeaders(params.token),
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params.body),
    cache: 'no-store',
  })

  const data = (await response.json().catch(() => ({ error: 'Invalid JSON response' }))) as
    | T
    | { error?: string }

  return {
    ok: response.ok,
    status: response.status,
    data,
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

type JobItemStatusDoc = {
  id?: string | number
  status?: string
  draftAttempt?: number
  articleSlug?: string
  categorySlug?: string
  article?: string | number
  error?: string
}

function isTerminalItemStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'draft-rejected'
}

export async function tryFinalizeGenerationJob(params: {
  baseUrl: string
  tokenForInternalCalls: string | undefined
  jobId: string | number
}): Promise<{ finalized: boolean; pending: boolean; status?: 'completed' | 'failed' }> {
  const { jobId } = params
  const payload = await getPayload()
  if (!payload) {
    throw new Error('Database unavailable')
  }

  const job = (await payload.findByID({
    collection: 'generation-jobs',
    id: jobId,
    depth: 0,
  })) as { id?: string | number; status?: string; metadata?: unknown }

  if (!job?.id) {
    throw new Error(`Generation job ${String(jobId)} not found`)
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return { finalized: true, pending: false, status: job.status }
  }

  const refreshedItems = await payload.find({
    collection: 'generation-job-items',
    where: { job: { equals: jobId } },
    limit: 200,
    sort: 'slotIndex',
    depth: 0,
  })
  const refreshedDocs = normalizeArray<JobItemStatusDoc>(refreshedItems.docs)
  const completedItems = refreshedDocs.filter((doc) => doc.status === 'completed')
  const failedItems = refreshedDocs.filter(
    (doc) => doc.status === 'failed' || doc.status === 'draft-rejected',
  )
  const inProgressItems = refreshedDocs.filter((doc) => !isTerminalItemStatus(doc.status))
  const acceptedCount = refreshedDocs.filter(
    (doc) =>
      doc.status === 'draft-accepted' || doc.status === 'processing' || doc.status === 'completed',
  ).length
  const draftRetriesUsed = refreshedDocs.reduce((sum, doc) => {
    const attempts = Number(doc.draftAttempt ?? 0)
    return sum + Math.max(0, attempts - 1)
  }, 0)

  await payload.update({
    collection: 'generation-jobs',
    id: jobId,
    data: {
      acceptedCount,
      createdCount: completedItems.length,
      failedCount: failedItems.length,
      draftRetriesUsed,
    },
  })

  if (inProgressItems.length > 0) {
    CRON_LOG.info(
      `JOB ${String(jobId)}: finalization pending | inProgress=${inProgressItems.length} completed=${completedItems.length} failed=${failedItems.length}`,
    )
    return { finalized: false, pending: true }
  }
  CRON_LOG.info(
    `JOB ${String(jobId)}: finalization ready | completed=${completedItems.length} failed=${failedItems.length}`,
  )

  const lockToken = `lock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const lockMetadata = toRecord(job.metadata)
  await payload.update({
    collection: 'generation-jobs',
    id: jobId,
    data: {
      status: 'finalizing',
      metadata: {
        ...lockMetadata,
        finalizationLock: lockToken,
        finalizationLockAt: new Date().toISOString(),
      },
    },
  })

  const lockCheck = (await payload.findByID({
    collection: 'generation-jobs',
    id: jobId,
    depth: 0,
  })) as { status?: string; metadata?: unknown }
  const lockCheckMetadata = toRecord(lockCheck?.metadata)
  if (lockCheckMetadata.finalizationLock !== lockToken) {
    CRON_LOG.info(`JOB ${String(jobId)}: finalization lock already owned by another worker`)
    return { finalized: false, pending: true }
  }

  const createdArticles = completedItems
    .map((doc) => {
      if (!doc.articleSlug) return null
      return {
        id: String(doc.article ?? ''),
        slug: doc.articleSlug,
        categorySlug: doc.categorySlug ?? '',
      }
    })
    .filter((entry): entry is { id: string; slug: string; categorySlug: string } => entry !== null)

  const usedCategories = new Set(
    createdArticles.map((article) => article.categorySlug).filter(Boolean),
  )

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
      CRON_LOG.info(
        `JOB ${String(jobId)}: push notifications sent | sent=${notificationResult?.sent ?? 0} failed=${notificationResult?.failed ?? 0}`,
      )
    } catch (error) {
      console.error('Failed to send push notifications:', error)
    }
  }

  const revalidatedPaths: string[] = []
  if (createdArticles.length > 0) {
    try {
      revalidatePath('/')
      revalidatedPaths.push('/')
      revalidatePath('/archive')
      revalidatedPaths.push('/archive')
      for (const categorySlug of usedCategories) {
        revalidatePath(`/section/${categorySlug}`)
        revalidatedPaths.push(`/section/${categorySlug}`)
      }
      CRON_LOG.info(
        `JOB ${String(jobId)}: revalidated ${revalidatedPaths.length} path(s) | ${revalidatedPaths.join(', ')}`,
      )
    } catch (error) {
      console.error(`${CRON_LOG.prefix} Failed to revalidate cache:`, error)
    }
  }

  let instagramResult: {
    sent?: number
    failed?: number
    skipped?: boolean
    reason?: string
  } | null = null
  if (createdArticles.length > 0 && process.env.CRON_AUTO_PUBLISH_INSTAGRAM === 'true') {
    instagramResult = {
      skipped: true,
      reason: 'Handled per article during item processing',
    }
    CRON_LOG.info(`JOB ${String(jobId)}: instagram publish handled per article during processing`)
  }

  const finalStatus: 'completed' | 'failed' = createdArticles.length > 0 ? 'completed' : 'failed'
  const finalErrors = failedItems
    .map((doc, index) => {
      const trimmed = (doc.error ?? '').trim()
      if (!trimmed) return null
      return `item ${index + 1}: ${trimmed}`
    })
    .filter((entry): entry is string => entry !== null)

  const latestJob = (await payload.findByID({
    collection: 'generation-jobs',
    id: jobId,
    depth: 0,
  })) as { metadata?: unknown }
  const latestMetadata = toRecord(latestJob?.metadata)
  delete latestMetadata.finalizationLock
  delete latestMetadata.finalizationLockAt

  await payload.update({
    collection: 'generation-jobs',
    id: jobId,
    data: {
      status: finalStatus,
      acceptedCount,
      createdCount: createdArticles.length,
      failedCount: failedItems.length,
      draftRetriesUsed,
      errorSummary: finalErrors.slice(0, 12).join('\n') || undefined,
      completedAt: new Date().toISOString(),
      metadata: {
        ...latestMetadata,
        notificationResult,
        revalidatedPaths,
        instagramResult,
        finalizedAt: new Date().toISOString(),
      },
    },
  })

  CRON_LOG.step(
    `JOB ${String(jobId)}: finished | created=${createdArticles.length} failed=${failedItems.length}`,
  )
  return { finalized: true, pending: false, status: finalStatus }
}

export async function runGenerationPipeline(params: {
  baseUrl: string
  tokenForInternalCalls: string | undefined
  jobId: string | number
}): Promise<void> {
  const { baseUrl, tokenForInternalCalls, jobId } = params
  const payload = await getPayload()
  if (!payload) {
    throw new Error('Database unavailable')
  }

  let currentStage = 'init'
  try {
    currentStage = 'init'
    CRON_LOG.info(`JOB ${String(jobId)}: stage=${currentStage}`)
    CRON_LOG.step(`JOB ${String(jobId)}: pipeline started`)

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

    currentStage = 'load-context'
    CRON_LOG.info(`JOB ${String(jobId)}: stage=${currentStage}`)
    const [authorsRes, recentArticlesRes, rssTopicsResult] = await Promise.all([
      payload.find({ collection: 'authors', limit: 100, sort: 'name' }),
      payload.find({
        collection: 'articles',
        where: { status: { equals: 'published' } },
        limit: 50,
        sort: '-publishedAt',
        depth: 0,
      }),
      fetchRssTopics(),
    ])
    CRON_LOG.info(
      `JOB ${String(jobId)}: context loaded | categories=${categoriesForCheck.totalDocs ?? 0} authors=${authorsRes.totalDocs ?? 0} recentArticles=${recentArticlesRes.totalDocs ?? 0} rssTopics=${rssTopicsResult.topics.length}`,
    )

    currentStage = 'seed-checks'
    CRON_LOG.info(`JOB ${String(jobId)}: stage=${currentStage}`)
    let categoriesFinal = categoriesForCheck
    let authorsFinal = authorsRes

    if ((categoriesForCheck.totalDocs ?? 0) === 0) {
      CRON_LOG.warn(`JOB ${String(jobId)}: categories empty, seeding baseline categories`)
      for (const cat of BASELINE_CATEGORIES) {
        await payload.create({ collection: 'categories', data: cat })
      }
      categoriesFinal = await payload.find({ collection: 'categories', limit: 100, sort: 'order' })
    }

    const currentAuthorsCount = authorsRes.totalDocs ?? 0
    if (currentAuthorsCount < MIN_AUTHOR_POOL) {
      const toCreate = Math.min(MAX_NEW_AUTHORS_PER_RUN, MIN_AUTHOR_POOL - currentAuthorsCount)
      CRON_LOG.info(
        `JOB ${String(jobId)}: author pool below minimum (${currentAuthorsCount}/${MIN_AUTHOR_POOL}), generating ${toCreate}`,
      )
      const newAuthors = await generateAuthors({ count: toCreate })
      for (const author of newAuthors) {
        try {
          await payload.create({ collection: 'authors', data: author })
        } catch {}
      }
      authorsFinal = await payload.find({ collection: 'authors', limit: 100, sort: 'name' })
    }

    currentStage = 'shape-context'
    CRON_LOG.info(`JOB ${String(jobId)}: stage=${currentStage}`)
    const categories = normalizeArray<{ slug?: string; name?: string; id?: string | number }>(
      categoriesFinal.docs,
    )
      .filter((c) => c && c.id != null && typeof c.slug === 'string' && typeof c.name === 'string')
      .map((c) => ({
        id: c.id as string | number,
        slug: c.slug as string,
        name: c.name as string,
      }))

    const authors = normalizeArray<{
      slug?: string
      name?: string
      id?: string | number
      title?: string
      bio?: string
    }>(authorsFinal.docs)
      .filter((a) => a && a.id != null && typeof a.slug === 'string' && typeof a.name === 'string')
      .map((a) => ({
        id: a.id as string | number,
        slug: a.slug as string,
        name: a.name as string,
        title: a.title,
        bio: a.bio,
      }))

    if (categories.length === 0 || authors.length === 0) {
      throw new Error('No categories or authors available')
    }

    const recentlyUsedRssTopics = new Set(
      recentArticlesRes.docs
        .map((a) => {
          const doc = a as { sourceRssTopic?: string }
          return doc.sourceRssTopic
        })
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .map((t) => normalizeTopicIdentity(t))
        .filter((t) => t.length > 0),
    )

    const freshTopics = rssTopicsResult.topics.filter(
      (t) => !recentlyUsedRssTopics.has(normalizeTopicIdentity(t.title)),
    )

    CRON_LOG.info(
      `JOB ${String(jobId)}: rss topic filtering | fetched=${rssTopicsResult.topics.length} fresh=${freshTopics.length} lockedFromRecent=${recentlyUsedRssTopics.size}`,
    )

    const recentCoverage = toRecentCoverageItems(recentArticlesRes.docs)
    const recentArticleTitles = recentCoverage.map((x) => x.headline)
    const recentArticleExcerpts = recentCoverage.map((x) => x.excerpt)

    const recentCanonicalStoryReferences = recentArticlesRes.docs
      .map((a) => {
        const doc = a as { canonicalSourceAuthor?: string; canonicalSourceStory?: string }
        return {
          author: doc.canonicalSourceAuthor?.trim() ?? '',
          story: doc.canonicalSourceStory?.trim() ?? '',
        }
      })
      .filter((ref) => ref.author.length > 0 && ref.story.length > 0)
      .slice(0, 20)

    let latestArticleContentSample: string | undefined
    if (recentArticlesRes.docs.length > 0) {
      const latestDoc = recentArticlesRes.docs[0] as { content?: unknown }
      if (latestDoc.content) {
        const fullText = extractTextFromLexical(latestDoc.content)
        const halfLength = Math.min(Math.floor(fullText.length / 2), 1500)
        if (halfLength > 100) {
          latestArticleContentSample = `${fullText.slice(0, halfLength)}...`
        }
      }
    }

    const recentHeadlinePatterns = extractHeadlinePatterns(recentArticleTitles)
    const uniquePatterns = Array.from(new Set(recentHeadlinePatterns))

    const hasRssTopics = freshTopics.length > 0

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

    let prioritizedTopics = freshTopics
    if (hasRssTopics) {
      try {
        const rankedIndexes = await rankRssTopicsForHumor({
          titles: freshTopics.map((t) => t.title),
        })
        if (rankedIndexes.length > 0) {
          prioritizedTopics = rankedIndexes.map((index) => freshTopics[index]!).filter(Boolean)
        }
      } catch (error) {
        CRON_LOG.warn(
          `JOB ${String(jobId)}: rss topic ranking failed, falling back to chronological order (${error instanceof Error ? error.message : 'unknown error'})`,
        )
      }
    }

    const topicSummary = prioritizedTopics.map((t) => `- [${t.source}] ${t.title}`).join('\n')

    currentStage = 'prepare-slots'
    CRON_LOG.info(`JOB ${String(jobId)}: stage=${currentStage}`)
    const precomputedBlacklistSummary = blacklistCache.summary
    const slotConfigs = computeSlotConfigs(ARTICLES_PER_RUN, hasRssTopics, forceOpinionThisRun)
    CRON_LOG.info(
      `JOB ${String(jobId)}: prepared ${slotConfigs.length} slots | hasRssTopics=${hasRssTopics} forceOpinion=${forceOpinionThisRun} blacklistCache=${blacklistCache.cacheHit ? 'HIT' : 'MISS'}`,
    )

    await payload.update({
      collection: 'generation-jobs',
      id: jobId,
      data: {
        status: 'evaluating',
        startedAt: new Date().toISOString(),
        requestedCount: ARTICLES_PER_RUN,
        metadata: {
          hasRssTopics,
          forceOpinionThisRun,
          slotConfigs,
          blacklistCacheHit: blacklistCache.cacheHit,
          blacklistSignature: blacklistCache.signature,
        },
      },
    })

    currentStage = 'sync-items'
    CRON_LOG.info(`JOB ${String(jobId)}: stage=${currentStage}`)
    const existingItems = await payload.find({
      collection: 'generation-job-items',
      where: { job: { equals: jobId } },
      limit: 200,
      depth: 0,
    })
    await Promise.all(
      normalizeArray<{ id?: string | number }>(existingItems.docs)
        .filter((doc) => doc?.id != null)
        .map(async (doc) => {
          await payload.delete({
            collection: 'generation-job-items',
            id: doc.id as string | number,
          })
        }),
    )

    const jobItems = await Promise.all(
      slotConfigs.map(async (slot, index) => {
        const item = await payload.create({
          collection: 'generation-job-items',
          data: {
            job: jobId,
            slotIndex: index,
            status: 'draft-pending',
            draftAttempt: 0,
            slotConfig: slot,
          },
        })
        if (item?.id == null) {
          throw new Error(`generation-job-items create returned no id (slotIndex=${index})`)
        }
        return { id: item.id as string | number, slotIndex: index, slot }
      }),
    )
    CRON_LOG.info(`JOB ${String(jobId)}: created ${jobItems.length} generation-job-items`)

    await payload.update({
      collection: 'generation-jobs',
      id: jobId,
      data: {
        status: 'generating',
      },
    })

    currentStage = 'dispatch-slot-workers'
    CRON_LOG.info(`JOB ${String(jobId)}: stage=${currentStage}`)
    CRON_LOG.step(`JOB ${String(jobId)}: Dispatch slot workers`)

    const dispatchResults = await Promise.allSettled(
      jobItems.map((item) =>
        callInternalJson<{ ok?: boolean; queued?: boolean; error?: string }>({
          baseUrl,
          path: '/api/internal/generation/slot-worker',
          token: tokenForInternalCalls,
          body: {
            jobId,
            itemId: item.id,
            slot: item.slot,
            topicSummary,
            recentCoverage,
            recentArticleTitles,
            recentArticleExcerpts,
            recentCanonicalStoryReferences,
            precomputedBlacklistSummary,
            recentHeadlinePatterns: uniquePatterns,
            latestArticleContentSample,
            maxDraftAttempts: MAX_DRAFT_RETRIES + 1,
            forbiddenSourceTopics: Array.from(recentlyUsedRssTopics),
            publish: true,
            setAsHeadline: item.slotIndex === 0,
          },
        }),
      ),
    )

    const dispatchFailures: Array<{ itemId: string | number; slotIndex: number; message: string }> =
      []
    let queuedCount = 0

    dispatchResults.forEach((result, index) => {
      const item = jobItems[index]
      if (result.status === 'rejected') {
        const message = String(result.reason)
        dispatchFailures.push({
          itemId: item.id,
          slotIndex: item.slotIndex,
          message,
        })
        CRON_LOG.warn(
          `JOB ${String(jobId)}: slot worker dispatch failed for slot ${item.slotIndex + 1} (${message})`,
        )
        return
      }

      if (!result.value.ok) {
        const message =
          (result.value.data as { error?: string }).error ?? `HTTP ${result.value.status}`
        dispatchFailures.push({
          itemId: item.id,
          slotIndex: item.slotIndex,
          message,
        })
        CRON_LOG.warn(
          `JOB ${String(jobId)}: slot worker dispatch rejected for slot ${item.slotIndex + 1} (${message})`,
        )
        return
      }

      queuedCount += 1
      CRON_LOG.info(
        `JOB ${String(jobId)}: slot worker queued for slot ${item.slotIndex + 1}/${jobItems.length}`,
      )
    })

    if (dispatchFailures.length > 0) {
      const now = new Date().toISOString()
      await Promise.all(
        dispatchFailures.map((failure) =>
          payload.update({
            collection: 'generation-job-items',
            id: failure.itemId,
            data: {
              status: 'failed',
              error: `Slot worker dispatch failed: ${failure.message}`,
              completedAt: now,
            },
          }),
        ),
      )
    }

    const dispatchErrorSummary =
      dispatchFailures
        .map((failure) => `slot ${failure.slotIndex + 1}: ${failure.message}`)
        .slice(0, 12)
        .join('\n') || undefined
    const allDispatchesFailed = queuedCount === 0

    await payload.update({
      collection: 'generation-jobs',
      id: jobId,
      data: {
        status: allDispatchesFailed ? 'failed' : 'generating',
        failedCount: dispatchFailures.length,
        errorSummary: dispatchErrorSummary,
        completedAt: allDispatchesFailed ? new Date().toISOString() : undefined,
        metadata: {
          hasRssTopics,
          forceOpinionThisRun,
          slotConfigs,
          blacklistCacheHit: blacklistCache.cacheHit,
          blacklistSignature: blacklistCache.signature,
          dispatchQueuedAt: new Date().toISOString(),
          dispatchQueuedCount: queuedCount,
          dispatchFailedCount: dispatchFailures.length,
        },
      },
    })

    CRON_LOG.info(
      `JOB ${String(jobId)}: slot worker dispatch complete | queued=${queuedCount}/${jobItems.length} failedDispatches=${dispatchFailures.length}`,
    )

    if (!allDispatchesFailed) {
      await tryFinalizeGenerationJob({ baseUrl, tokenForInternalCalls, jobId })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Pipeline job ${String(jobId)} failed at stage=${currentStage}:`, error)
    await payload.update({
      collection: 'generation-jobs',
      id: jobId,
      data: {
        status: 'failed',
        errorSummary: `[stage=${currentStage}] ${message}`,
        completedAt: new Date().toISOString(),
      },
    })
  }
}
