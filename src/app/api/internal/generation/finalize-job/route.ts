import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getInternalCronTokenForCalls,
  isInternalCronAuthorized,
} from '@/lib/generation/internalAuth'
import { tryFinalizeGenerationJob } from '@/lib/generation/runGenerationPipeline'

export const maxDuration = 120
const LOG_PREFIX = '[INTERNAL-FINALIZE-JOB]'

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

  try {
    const result = await tryFinalizeGenerationJob({
      baseUrl: request.url,
      tokenForInternalCalls: getInternalCronTokenForCalls(request),
      jobId: body.jobId,
    })

    console.log(
      `${LOG_PREFIX} Finalization attempted for job ${String(body.jobId)} | finalized=${result.finalized} pending=${result.pending} status=${result.status ?? 'n/a'}`,
    )

    return NextResponse.json({
      ok: true,
      jobId: String(body.jobId),
      ...result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to finalize job'
    console.error(
      `${LOG_PREFIX} Finalization failed for job ${String(body.jobId)} (${message})`,
      error,
    )
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
