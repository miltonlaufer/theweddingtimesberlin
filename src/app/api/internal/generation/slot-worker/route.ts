import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { getPayload } from '@/lib/payload'
import {
  getInternalCronTokenForCalls,
  isInternalCronAuthorized,
} from '@/lib/generation/internalAuth'
import { tryFinalizeGenerationJob } from '@/lib/generation/runGenerationPipeline'

export const maxDuration = 300
const LOG_PREFIX = '[INTERNAL-SLOT-WORKER]'

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
  }),
  topicSummary: z.string(),
  recentCoverage: z
    .array(
      z.object({
        headline: z.string(),
        excerpt: z.string().optional().default(''),
      }),
    )
    .default([]),
  recentArticleTitles: z.array(z.string()).default([]),
  recentArticleExcerpts: z.array(z.string()).default([]),
  recentCanonicalStoryReferences: z
    .array(z.object({ author: z.string(), story: z.string() }))
    .default([]),
  precomputedBlacklistSummary: z.string().default(''),
  recentHeadlinePatterns: z.array(z.string()).default([]),
  latestArticleContentSample: z.string().optional(),
  maxDraftAttempts: z.number().int().min(1).max(6),
  forbiddenSourceTopics: z.array(z.string()).default([]),
  publish: z.boolean().optional().default(true),
  setAsHeadline: z.boolean().optional().default(false),
})

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
  }

  if (params.token?.trim()) {
    headers.authorization = `Bearer ${params.token.trim()}`
    headers['x-cron-secret'] = params.token.trim()
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

async function markItemTerminalStatus(params: {
  itemId: string | number
  status: 'failed' | 'draft-rejected'
  error: string
}): Promise<void> {
  const payload = await getPayload()
  if (!payload) return

  await payload.update({
    collection: 'generation-job-items',
    id: params.itemId,
    data: {
      status: params.status,
      error: params.error,
      completedAt: new Date().toISOString(),
    },
  })
}

async function loadAcceptedDrafts(params: {
  jobId: string | number
  currentItemId: string | number
}): Promise<Array<{ headline: string; subheadline: string | null; excerpt: string | null }>> {
  const payload = await getPayload()
  if (!payload) return []

  const items = await payload.find({
    collection: 'generation-job-items',
    where: { job: { equals: params.jobId } },
    limit: 200,
    depth: 0,
  })

  return (
    items.docs as Array<{
      id?: string | number
      status?: string
      headline?: string
      subheadline?: string | null
      excerpt?: string | null
    }>
  )
    .filter((doc) => {
      if (!doc?.id) return false
      if (String(doc.id) === String(params.currentItemId)) return false
      if (!doc.headline?.trim()) return false
      return (
        doc.status === 'draft-accepted' || doc.status === 'processing' || doc.status === 'completed'
      )
    })
    .map((doc) => ({
      headline: (doc.headline ?? '').trim(),
      subheadline: doc.subheadline?.trim() || null,
      excerpt: doc.excerpt?.trim() || null,
    }))
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isInternalCronAuthorized(request)) {
    console.warn(`${LOG_PREFIX} Unauthorized request`)
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

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

  const tokenForInternalCalls = getInternalCronTokenForCalls(request)
  const baseUrl = request.url
  console.log(
    `${LOG_PREFIX} Accepted slot ${String(body.itemId)} for job ${String(body.jobId)}; scheduling slot worker`,
  )

  after(async () => {
    const attemptedSourceTopicsForSlot = new Set(
      body.forbiddenSourceTopics
        .map((topic) => normalizeTopicIdentity(topic))
        .filter((topic) => topic.length > 0),
    )

    let accepted = false
    let draftErrorMessage = ''

    try {
      for (let attempt = 1; attempt <= body.maxDraftAttempts; attempt++) {
        console.log(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} draft attempt ${attempt}/${body.maxDraftAttempts}`,
        )

        const acceptedDrafts = await loadAcceptedDrafts({
          jobId: body.jobId,
          currentItemId: body.itemId,
        })

        const draftResult = await callInternalJson<{
          accepted?: boolean
          exhausted?: boolean
          draft?: { headline: string }
          sourceRssTopic?: string | null
          evaluation?: { reason?: string }
          error?: string
        }>({
          baseUrl,
          path: '/api/internal/generation/retry-draft',
          token: tokenForInternalCalls,
          body: {
            jobId: body.jobId,
            itemId: body.itemId,
            maxAttempts: body.maxDraftAttempts,
            slot: body.slot,
            topicSummary: body.topicSummary,
            recentCoverage: body.recentCoverage,
            acceptedDrafts,
            forbiddenSourceTopics: Array.from(attemptedSourceTopicsForSlot),
            blacklistSummary: body.precomputedBlacklistSummary,
          },
        })

        if (!draftResult.ok) {
          const errorMessage =
            (draftResult.data as { error?: string }).error ?? `HTTP ${draftResult.status}`
          draftErrorMessage = errorMessage
          console.warn(
            `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} draft attempt ${attempt} failed (${errorMessage})`,
          )
          continue
        }

        const payloadData = draftResult.data as {
          accepted?: boolean
          exhausted?: boolean
          draft?: { headline: string }
          sourceRssTopic?: string | null
          evaluation?: { reason?: string }
        }
        const sourceTopic =
          typeof payloadData.sourceRssTopic === 'string' &&
          payloadData.sourceRssTopic.trim().length > 0
            ? payloadData.sourceRssTopic.trim()
            : null

        if (sourceTopic) {
          attemptedSourceTopicsForSlot.add(normalizeTopicIdentity(sourceTopic))
        }

        if (payloadData.accepted && payloadData.draft) {
          accepted = true
          console.log(
            `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} draft accepted on attempt ${attempt} | "${payloadData.draft.headline.slice(0, 120)}"`,
          )
          break
        }

        if (payloadData.exhausted) {
          draftErrorMessage = payloadData.evaluation?.reason ?? 'Draft rejected'
          break
        }
      }

      if (!accepted) {
        const message = draftErrorMessage || 'Draft rejected after max attempts'
        await markItemTerminalStatus({
          itemId: body.itemId,
          status: 'draft-rejected',
          error: message,
        })
        await tryFinalizeGenerationJob({
          baseUrl,
          tokenForInternalCalls,
          jobId: body.jobId,
        })
        return
      }

      const processResult = await callInternalJson<{ ok?: boolean; error?: string }>({
        baseUrl,
        path: '/api/internal/generation/process-item',
        token: tokenForInternalCalls,
        body: {
          jobId: body.jobId,
          itemId: body.itemId,
          slot: body.slot,
          topicSummary: body.topicSummary,
          recentArticleTitles: body.recentArticleTitles,
          recentArticleExcerpts: body.recentArticleExcerpts,
          recentCanonicalStoryReferences: body.recentCanonicalStoryReferences,
          precomputedBlacklistSummary: body.precomputedBlacklistSummary,
          recentHeadlinePatterns: body.recentHeadlinePatterns,
          latestArticleContentSample: body.latestArticleContentSample,
          publish: body.publish,
          setAsHeadline: body.setAsHeadline,
        },
      })

      if (!processResult.ok) {
        const processError =
          (processResult.data as { error?: string }).error ?? `HTTP ${processResult.status}`
        console.warn(
          `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} process-item failed (${processError})`,
        )
        await markItemTerminalStatus({
          itemId: body.itemId,
          status: 'failed',
          error: processError,
        })
      }

      await tryFinalizeGenerationJob({
        baseUrl,
        tokenForInternalCalls,
        jobId: body.jobId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `${LOG_PREFIX} Slot worker crashed for job ${String(body.jobId)} item ${String(body.itemId)} (${message})`,
        error,
      )
      await markItemTerminalStatus({
        itemId: body.itemId,
        status: 'failed',
        error: message,
      })
      try {
        await tryFinalizeGenerationJob({
          baseUrl,
          tokenForInternalCalls,
          jobId: body.jobId,
        })
      } catch (finalizeError) {
        console.error(
          `${LOG_PREFIX} Finalization check failed after slot worker crash for job ${String(body.jobId)}`,
          finalizeError,
        )
      }
    }
  })

  return NextResponse.json({
    ok: true,
    queued: true,
    jobId: String(body.jobId),
    itemId: String(body.itemId),
  })
}
