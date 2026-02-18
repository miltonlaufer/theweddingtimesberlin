import { NextResponse } from 'next/server'
import { getPayload, resetPayload } from '@/lib/payload'
import {
  buildInternalAuthHeaders,
  getInternalCronSecret,
  getProvidedInternalCronToken,
} from '@/lib/generation/internalAuth'
import { ARTICLES_PER_RUN } from '@/lib/generation/runGenerationPipeline'

const CRON_LOG = {
  prefix: '[CRON-GENERATE]',
  sep: '════════════════════════════════════════════════════════════════',
  step: (label: string) =>
    console.log(
      `${CRON_LOG.prefix} ${CRON_LOG.sep}\n${CRON_LOG.prefix} ${label}\n${CRON_LOG.prefix} ${CRON_LOG.sep}`,
    ),
}

async function kickoffRunJob(params: {
  baseUrl: string
  tokenForInternalCalls: string | undefined
  jobId: string | number
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const kickoffUrl = new URL('/api/internal/generation/run-job', params.baseUrl).toString()
  const response = await fetch(kickoffUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildInternalAuthHeaders(params.tokenForInternalCalls),
    },
    body: JSON.stringify({ jobId: params.jobId }),
    cache: 'no-store',
  })

  if (response.ok) {
    return { ok: true, status: response.status }
  }

  const data = (await response.json().catch(() => ({ error: 'Invalid JSON response' }))) as {
    error?: string
  }
  return {
    ok: false,
    status: response.status,
    error: data.error ?? `HTTP ${response.status}`,
  }
}

function extractProvidedSecret(request: Request): string | undefined {
  return getProvidedInternalCronToken(request)
}

function isStalePayloadCreateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Cannot use 'in' operator to search for '_rels' in undefined")
}

export async function GET(req: Request): Promise<NextResponse> {
  CRON_LOG.step('STEP 1: Cron enqueue request received')

  const cronSecret = process.env.CRON_SECRET?.trim() ?? ''
  const internalSecret = getInternalCronSecret()
  const providedSecret = extractProvidedSecret(req)
  const isProd = process.env.NODE_ENV === 'production'

  if (isProd && cronSecret && providedSecret !== cronSecret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (isProd && !internalSecret) {
    console.error(`${CRON_LOG.prefix} Missing internal auth secret. Set CRON_SECRET in production.`)
    return NextResponse.json(
      {
        ok: false,
        error: 'Internal auth secret missing in production',
      },
      { status: 500 },
    )
  }

  let payload = await getPayload()
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503 })
  }

  const tokenForInternalCalls = providedSecret ?? (internalSecret || undefined)
  const jobKey = `cron-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random()
    .toString(36)
    .slice(2, 8)}`

  let jobDoc: { id: string | number }
  try {
    const created = (await payload.create({
      collection: 'generation-jobs',
      data: {
        jobKey,
        status: 'drafting',
        requestedCount: ARTICLES_PER_RUN,
        acceptedCount: 0,
        createdCount: 0,
        failedCount: 0,
        draftRetriesUsed: 0,
        startedAt: new Date().toISOString(),
        metadata: {
          queued: true,
          queuedAt: new Date().toISOString(),
        },
      },
    })) as { id?: string | number } | null

    if (!created?.id) {
      throw new Error('generation-jobs create returned no id')
    }
    jobDoc = { id: created.id }
  } catch (error) {
    if (!isStalePayloadCreateError(error)) {
      console.error(`${CRON_LOG.prefix} Failed to create generation job`, error)
      return NextResponse.json(
        { ok: false, error: 'Failed to create generation job' },
        { status: 500 },
      )
    }

    console.warn(`${CRON_LOG.prefix} Stale Payload instance detected, retrying with fresh init`)
    resetPayload()
    payload = await getPayload()

    if (!payload) {
      return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503 })
    }

    const retried = (await payload.create({
      collection: 'generation-jobs',
      data: {
        jobKey,
        status: 'drafting',
        requestedCount: ARTICLES_PER_RUN,
        acceptedCount: 0,
        createdCount: 0,
        failedCount: 0,
        draftRetriesUsed: 0,
        startedAt: new Date().toISOString(),
        metadata: {
          queued: true,
          queuedAt: new Date().toISOString(),
        },
      },
    })) as { id?: string | number } | null

    if (!retried?.id) {
      return NextResponse.json(
        { ok: false, error: 'Failed to create generation job after retry' },
        { status: 500 },
      )
    }
    jobDoc = { id: retried.id }
  }

  const kickoff = await kickoffRunJob({
    baseUrl: req.url,
    tokenForInternalCalls,
    jobId: jobDoc.id,
  })

  if (!kickoff.ok) {
    const errorMessage = kickoff.error ?? `HTTP ${kickoff.status}`
    await payload.update({
      collection: 'generation-jobs',
      id: jobDoc.id,
      data: {
        status: 'failed',
        errorSummary: `Failed to start worker job: ${errorMessage}`,
        completedAt: new Date().toISOString(),
      },
    })

    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to start background generation worker',
        details: errorMessage,
        jobId: String(jobDoc.id),
      },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      queued: true,
      jobId: String(jobDoc.id),
      summary: `Generation job queued for ${ARTICLES_PER_RUN} article slots`,
    },
    { status: 202 },
  )
}
