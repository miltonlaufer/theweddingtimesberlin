import React from 'react'
import { NytContainer } from '@/components/NytContainer'
import { ArticleArchive } from '@/components/ArticleArchive'
import { searchArticles, type SortOrder } from '@/lib/articles/searchArticles'

/******************* RENDERING CONFIG ***********************/

// Dynamic rendering for search - no caching since query params change frequently
export const dynamic = 'force-dynamic'

/******************* PAGE ***********************/

export default async function SearchPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const query = resolvedSearchParams?.q ?? ''
  const rawPage = resolvedSearchParams?.page
  const page = rawPage ? Math.max(1, Math.floor(Number(rawPage) || 1)) : 1
  const rawSort = resolvedSearchParams?.sort
  const sortOrder: SortOrder = rawSort === 'asc' ? 'asc' : 'desc'

  // If no query provided, show empty state
  if (!query.trim()) {
    return (
      <NytContainer className="py-8">
        <div className="border-b border-[#e2e2e2] pb-2">
          <h2 className="font-sans text-sm uppercase tracking-wider text-[#121212]">Search</h2>
        </div>
        <div className="py-12 text-center">
          <p className="font-sans text-[#666]">Enter a search term to find articles.</p>
        </div>
      </NytContainer>
    )
  }

  // Perform the search
  const res = await searchArticles({
    query,
    limit: 20,
    page,
    sortOrder,
  }).catch(() => ({
    articles: [],
    page: 1,
    totalPages: 1,
    totalDocs: 0,
    hasNextPage: false,
    hasPrevPage: false,
    query,
    sortOrder,
  }))

  return (
    <NytContainer className="py-8">
      <ArticleArchive
        articles={res.articles}
        page={res.page}
        totalPages={res.totalPages}
        totalDocs={res.totalDocs}
        basePath="/search"
        title="Search Results"
        searchQuery={query}
        sortOrder={sortOrder}
        showSortControls
      />
    </NytContainer>
  )
}
