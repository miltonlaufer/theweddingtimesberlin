import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

/******************* ROUTE HANDLER ***********************/

export async function POST(req: Request) {
  // Verify cron secret (same auth as cron job)
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const providedSecret = authHeader?.replace('Bearer ', '')
  const isProd = process.env.NODE_ENV === 'production'

  // In production, require the secret. In dev, allow manual triggering.
  if (isProd && cronSecret && providedSecret !== cronSecret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => null)

    const pathsFromBody: string[] = Array.isArray(body?.paths)
      ? body.paths.filter((p: unknown): p is string => typeof p === 'string' && p.startsWith('/'))
      : []

    const articleSlugsFromBody: string[] = Array.isArray(body?.articleSlugs)
      ? body.articleSlugs.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
      : []

    const defaultPaths = ['/', '/archive']
    const articlePaths = articleSlugsFromBody.map((s) => `/article/${s}`)

    const pathsToRevalidate = Array.from(
      new Set([...defaultPaths, ...pathsFromBody, ...articlePaths]),
    )

    for (const p of pathsToRevalidate) {
      revalidatePath(p)
    }

    return NextResponse.json({
      ok: true,
      revalidated: pathsToRevalidate,
    })
  } catch (error) {
    console.error('Cache revalidation error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
