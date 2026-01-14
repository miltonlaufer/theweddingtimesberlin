import { getPayload } from '@/lib/payload'
import { mapPayloadArticleToIArticle, type PayloadArticleLike } from '@/lib/articles/mapPayloadArticleToIArticle'

/******************* TYPES ***********************/

export interface FetchPublishedArticlesArgs {
  limit: number
  page?: number
}

export interface FetchPublishedArticlesResult {
  articles: ReturnType<typeof mapPayloadArticleToIArticle>[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

/******************* LOGGING ***********************/

const LOG_ENDPOINT =
  'http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c'

function log(location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'content-fetch',
      hypothesisId: 'A',
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion agent log
}

/******************* MAIN ***********************/

export async function fetchPublishedArticles(
  args: FetchPublishedArticlesArgs,
): Promise<FetchPublishedArticlesResult> {
  const payload = await getPayload()
  const page = args.page ?? 1

  log('src/lib/articles/fetchPublishedArticles.ts:49', 'fetch_start', {
    limit: args.limit,
    page,
  })

  const res = await payload.find({
    collection: 'articles',
    depth: 2,
    limit: args.limit,
    page,
    sort: '-publishedAt',
    where: {
      status: { equals: 'published' },
    },
  })

  log('src/lib/articles/fetchPublishedArticles.ts:66', 'fetch_result', {
    docs: res.docs.length,
    totalDocs: res.totalDocs,
    totalPages: res.totalPages,
    page: res.page,
  })

  return {
    articles: (res.docs as unknown as PayloadArticleLike[]).map(mapPayloadArticleToIArticle),
    totalDocs: res.totalDocs,
    totalPages: res.totalPages,
    page: res.page ?? page,
    hasNextPage: Boolean(res.hasNextPage),
    hasPrevPage: Boolean(res.hasPrevPage),
  }
}

