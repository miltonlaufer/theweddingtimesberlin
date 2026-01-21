import { getPayload } from '@/lib/payload'
import {
  mapPayloadArticleToIArticle,
  type PayloadArticleLike,
} from '@/lib/articles/mapPayloadArticleToIArticle'

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

/******************* EMPTY RESULT ***********************/

const EMPTY_RESULT: FetchPublishedArticlesResult = {
  articles: [],
  totalDocs: 0,
  totalPages: 1,
  page: 1,
  hasNextPage: false,
  hasPrevPage: false,
}

/******************* MAIN ***********************/

export async function fetchPublishedArticles(
  args: FetchPublishedArticlesArgs,
): Promise<FetchPublishedArticlesResult> {
  const payload = await getPayload()
  const page = args.page ?? 1

  // DB unavailable (build time) - return empty result
  if (!payload) {
    return { ...EMPTY_RESULT, page }
  }

  const res = await payload.find({
    collection: 'articles',
    depth: 1, // Only need first-level relations (category, author)
    limit: args.limit,
    page,
    sort: '-publishedAt',
    where: {
      status: { equals: 'published' },
    },
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
