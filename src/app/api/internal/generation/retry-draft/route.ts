import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPayload } from '@/lib/payload'
import { isInternalCronAuthorized } from '@/lib/generation/internalAuth'
import { evaluateDraftCandidate, generateDraftCandidate } from '@/lib/generation/draftPipeline'
import type { DraftCandidate, RecentCoverageItem, SlotConfig } from '@/lib/generation/pipelineTypes'

const LOG_PREFIX = '[INTERNAL-RETRY-DRAFT]'

const RssTopicSchema = z.object({
  source: z.enum(['berliner-zeitung', 'nytimes']),
  title: z.string().min(1).max(300),
  url: z.string().url().max(2000),
  publishedAt: z.string().max(100).optional(),
  description: z.string().max(800).optional(),
})

const RequestSchema = z.object({
  jobId: z.union([z.string(), z.number()]),
  itemId: z.union([z.string(), z.number()]),
  maxAttempts: z.number().int().min(1).max(6).optional(),
  slot: z.object({
    forceDrugsTechno: z.boolean().optional(),
    forceStartup: z.boolean().optional(),
    forceRss: z.boolean().optional(),
    forceAfR: z.boolean().optional(),
    forceOpinion: z.boolean(),
    includeTopics: z.boolean(),
    useHumorPerspectiveMethod: z.boolean().optional(),
    themeBucket: z.string().max(80).optional(),
    editorDirection: z.string().max(1200).optional(),
  }),
  topicSummary: z.string(),
  rssTopics: z.array(RssTopicSchema).max(100).default([]),
  recentCoverage: z
    .array(
      z.object({
        headline: z.string(),
        excerpt: z.string().optional().default(''),
      }),
    )
    .default([]),
  acceptedDrafts: z
    .array(
      z.object({
        headline: z.string(),
        subheadline: z.string().nullable().optional(),
        excerpt: z.string().nullable().optional(),
      }),
    )
    .default([]),
  forbiddenSourceTopics: z.array(z.string()).default([]),
  blacklistSummary: z.string().default(''),
})

type JobItemDoc = {
  id: string | number
  job?: string | number | { id: string | number }
  draftAttempt?: number
  headline?: string | null
  subheadline?: string | null
  excerpt?: string | null
  error?: string | null
  draftEvaluation?: { reason?: string } | null
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isInternalCronAuthorized(request)) {
    console.warn(`${LOG_PREFIX} Unauthorized request`)
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof RequestSchema>
  try {
    const json = (await request.json()) as unknown
    body = RequestSchema.parse(json)
  } catch (error) {
    console.warn(`${LOG_PREFIX} Invalid request body`, error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Invalid request body',
      },
      { status: 400 },
    )
  }

  const payload = await getPayload()
  if (!payload) {
    console.warn(`${LOG_PREFIX} Payload unavailable`)
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

  const maxAttempts = body.maxAttempts ?? 3
  const currentAttempt = Number(item.draftAttempt ?? 0)
  const nextAttempt = currentAttempt + 1
  console.log(
    `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} draft attempt ${nextAttempt}/${maxAttempts} | forbiddenSourceTopics=${body.forbiddenSourceTopics.length}`,
  )
  if (currentAttempt >= maxAttempts) {
    console.warn(
      `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} exhausted before attempt (max attempts reached)`,
    )
    return NextResponse.json({
      ok: true,
      accepted: false,
      exhausted: true,
      attempt: currentAttempt,
      reason: `max attempts reached (${maxAttempts})`,
    })
  }

  try {
    const slot: SlotConfig = {
      forceDrugsTechno: body.slot.forceDrugsTechno,
      forceStartup: body.slot.forceStartup,
      forceRss: body.slot.forceRss,
      forceAfR: body.slot.forceAfR,
      forceOpinion: body.slot.forceOpinion,
      includeTopics: body.slot.includeTopics,
      useHumorPerspectiveMethod: body.slot.useHumorPerspectiveMethod,
      themeBucket: body.slot.themeBucket,
      editorDirection: body.slot.editorDirection,
    }
    const recentCoverage: RecentCoverageItem[] = body.recentCoverage.map((entry) => ({
      headline: entry.headline,
      excerpt: entry.excerpt ?? '',
    }))

    const acceptedDrafts: DraftCandidate[] = body.acceptedDrafts.map((entry) => ({
      headline: entry.headline,
      subheadline: entry.subheadline ?? null,
      excerpt: entry.excerpt ?? null,
    }))
    const previousRejectionReason =
      item.error?.trim() || item.draftEvaluation?.reason?.trim() || 'Previous pitch was rejected.'
    const previousAttempt =
      currentAttempt > 0 && item.headline?.trim()
        ? {
            draft: {
              headline: item.headline.trim(),
              subheadline: item.subheadline?.trim() || null,
              excerpt: item.excerpt?.trim() || null,
            },
            rejectionReason: previousRejectionReason,
          }
        : undefined

    const { draft, sourceRssTopic } = await generateDraftCandidate({
      slot,
      topicSummary: body.topicSummary,
      rssTopics: body.rssTopics,
      recentCoverage,
      blacklistSummary: body.blacklistSummary,
      acceptedDrafts,
      forbiddenSourceTopics: body.forbiddenSourceTopics,
      previousAttempt,
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: draft,
      recentCoverage,
      acceptedDrafts,
    })

    await payload.update({
      collection: 'generation-job-items',
      id: body.itemId,
      data: {
        draftAttempt: nextAttempt,
        status: evaluation.accepted ? 'draft-accepted' : 'draft-rejected',
        headline: draft.headline,
        subheadline: draft.subheadline,
        excerpt: draft.excerpt,
        sourceRssTopic: sourceRssTopic ?? undefined,
        draftEvaluation: evaluation,
        error: evaluation.accepted ? undefined : evaluation.reason,
      },
    })
    if (evaluation.accepted) {
      console.log(
        `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} accepted on attempt ${nextAttempt} | "${draft.headline.slice(0, 120)}"`,
      )
    } else {
      console.warn(
        `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} rejected on attempt ${nextAttempt} | reason=${evaluation.reason}`,
      )
    }

    return NextResponse.json({
      ok: true,
      accepted: evaluation.accepted,
      exhausted: nextAttempt >= maxAttempts && !evaluation.accepted,
      attempt: nextAttempt,
      draft,
      sourceRssTopic,
      evaluation,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Draft generation failed'
    console.error(
      `${LOG_PREFIX} Job ${String(body.jobId)} item ${String(body.itemId)} failed on attempt ${nextAttempt} (${message})`,
      error,
    )
    await payload.update({
      collection: 'generation-job-items',
      id: body.itemId,
      data: {
        draftAttempt: currentAttempt + 1,
        status: 'draft-rejected',
        error: message,
      },
    })
    return NextResponse.json(
      {
        ok: false,
        accepted: false,
        error: message,
      },
      { status: 500 },
    )
  }
}
