import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import {
  getInternalCronTokenForCalls,
  isInternalCronAuthorized,
} from '@/lib/generation/internalAuth'
import { runGenerationPipeline } from '@/lib/generation/runGenerationPipeline'

export const maxDuration = 300
const LOG_PREFIX = '[INTERNAL-RUN-JOB]'

const RequestSchema = z.object({
  jobId: z.union([z.string(), z.number()]),
})

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
