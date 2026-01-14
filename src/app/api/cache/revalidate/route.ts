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
    // Revalidate homepage and archive
    revalidatePath('/')
    revalidatePath('/archive')

    return NextResponse.json({ ok: true, message: 'Cache invalidated for homepage and archive' })
  } catch (error) {
    console.error('Cache revalidation error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
