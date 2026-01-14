import { NextResponse } from 'next/server'
import { generateArticle } from '@/lib/generation/generateArticle'

/******************* ROUTE ***********************/

export async function GET(req: Request) {
  const url = new URL(req.url)
  const includeTopics = url.searchParams.get('topics') !== '0'

  // Minimal fixed options to make the generator deterministic enough for a smoke test
  const categories = [
    { slug: 'bureaucracy', name: 'Bureaucracy' },
    { slug: 'nightlife', name: 'Nightlife' },
    { slug: 'opinion', name: 'Opinion' },
  ]

  const authors = [
    { slug: 'greta-schmidt', name: 'Greta Schmidt' },
    { slug: 'hans-muller', name: 'Hans Muller' },
  ]

  // Intentionally pass a small topic summary; the real cron will use RSS.
  const topicSummary =
    '- [nytimes] Global headlines about tech layoffs\n- [berliner-zeitung] Local story about BVG delays\n'

  try {
    const article = await generateArticle({
      categories,
      authors,
      topicSummary,
      includeTopics,
    })

    return NextResponse.json({ ok: true, article })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

