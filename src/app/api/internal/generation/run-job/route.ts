import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import {
  getInternalCronTokenForCalls,
  isInternalCronAuthorized,
} from '@/lib/generation/internalAuth'
import { runGenerationPipeline } from '@/lib/generation/runGenerationPipeline'
import { maintainInstagramAccessToken } from '@/lib/instagram/instagramTokenStore'
import {
  recordInstagramIntegrationFailure,
  recordInstagramIntegrationRecovery,
} from '@/lib/instagram/instagramAlerts'

export const maxDuration = 300
const LOG_PREFIX = '[INTERNAL-RUN-JOB]'
const INSTAGRAM_MAINTENANCE_TIMEOUT_MS = 30_000
const INSTAGRAM_ALERT_TIMEOUT_MS = 10_000

const RequestSchema = z.object({
  jobId: z.union([z.string(), z.number()]),
})

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function reportRefreshFailure(message: string): Promise<void> {
  try {
    await withTimeout(
      recordInstagramIntegrationFailure('refresh', message),
      INSTAGRAM_ALERT_TIMEOUT_MS,
      'Instagram refresh alert',
    )
  } catch (alertError) {
    console.warn(`${LOG_PREFIX} Instagram refresh alert delivery failed`, alertError)
  }
}

async function runInstagramTokenMaintenance(): Promise<void> {
  if (process.env.INSTAGRAM_ENABLED !== 'true') return

  let result: Awaited<ReturnType<typeof maintainInstagramAccessToken>>
  try {
    result = await withTimeout(
      maintainInstagramAccessToken(),
      INSTAGRAM_MAINTENANCE_TIMEOUT_MS,
      'Instagram token maintenance',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`${LOG_PREFIX} Instagram token maintenance crashed: ${message}`)
    await reportRefreshFailure(message)
    return
  }

  if (!result.ok) {
    console.warn(`${LOG_PREFIX} Instagram token maintenance failed: ${result.error}`)
    await reportRefreshFailure(result.error)
    return
  }

  console.log(`${LOG_PREFIX} Instagram token maintenance action=${result.action}`)
  if (result.action === 'refreshed') {
    try {
      await withTimeout(
        recordInstagramIntegrationRecovery('refresh'),
        INSTAGRAM_ALERT_TIMEOUT_MS,
        'Instagram recovery alert',
      )
    } catch (alertError) {
      console.warn(`${LOG_PREFIX} Instagram recovery alert delivery failed`, alertError)
    }
  }
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
  const jobId = body.jobId
  console.log(`${LOG_PREFIX} Accepted job ${String(body.jobId)}; scheduling background pipeline`)

  after(async () => {
    try {
      console.log(`${LOG_PREFIX} Starting pipeline for job ${String(jobId)}`)
      await runInstagramTokenMaintenance()
      await runGenerationPipeline({
        baseUrl,
        tokenForInternalCalls,
        jobId,
      })
      console.log(`${LOG_PREFIX} Pipeline finished for job ${String(jobId)}`)
    } catch (error) {
      console.error(`${LOG_PREFIX} Pipeline crashed for job ${String(jobId)}`, error)
    }
  })

  return NextResponse.json({
    ok: true,
    queued: true,
    jobId: String(body.jobId),
  })
}
