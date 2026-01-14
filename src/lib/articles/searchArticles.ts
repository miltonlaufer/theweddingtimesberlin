import { getPayload } from '@/lib/payload'
import { mapPayloadArticleToIArticle, type PayloadArticleLike } from '@/lib/articles/mapPayloadArticleToIArticle'
import type { IArticle } from '@/types/article'

/******************* TYPES ***********************/

export type SortOrder = 'asc' | 'desc'

export interface SearchArticlesArgs {
  query: string
  limit: number
  page?: number
  sortOrder?: SortOrder
}

export interface SearchArticlesResult {
  articles: IArticle[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
  query: string
  sortOrder: SortOrder
}

/******************* EMPTY RESULT ***********************/

const createEmptyResult = (query: string, page: number, sortOrder: SortOrder): SearchArticlesResult => ({
  articles: [],
  totalDocs: 0,
  totalPages: 1,
  page,
  hasNextPage: false,
  hasPrevPage: false,
  query,
  sortOrder,
})

/******************* MAIN ***********************/

export async function searchArticles(args: SearchArticlesArgs): Promise<SearchArticlesResult> {
  const payload = await getPayload()
  const page = args.page ?? 1
  const sortOrder = args.sortOrder ?? 'desc'
  const query = args.query.trim()

  // DB unavailable (build time) or empty query - return empty result
  if (!payload || !query) {
    return createEmptyResult(query, page, sortOrder)
  }

  // Determine sort field based on order
  const sort = sortOrder === 'asc' ? 'publishedAt' : '-publishedAt'

  // Search in headline, subheadline, and excerpt fields
  const res = await payload.find({
    collection: 'articles',
    depth: 2,
    limit: args.limit,
    page,
    sort,
    where: {
      and: [
        { status: { equals: 'published' } },
        {
          or: [
            { headline: { contains: query } },
            { subheadline: { contains: query } },
            { excerpt: { contains: query } },
          ],
        },
      ],
    },
  })

  return {
    articles: (res.docs as unknown as PayloadArticleLike[]).map(mapPayloadArticleToIArticle),
    totalDocs: res.totalDocs,
    totalPages: res.totalPages,
    page: res.page ?? page,
    hasNextPage: Boolean(res.hasNextPage),
    hasPrevPage: Boolean(res.hasPrevPage),
    query,
    sortOrder,
  }
}
