import React from 'react'
import Link from 'next/link'
import { ArticleCard } from '@/components/ArticleCard'
import type { IArticle } from '@/types/article'

/******************* TYPES ***********************/

export type SortOrder = 'asc' | 'desc'

interface ArticleArchiveProps {
  articles: IArticle[]
  page: number
  totalPages: number
  totalDocs?: number
  basePath: string
  title?: string
  searchQuery?: string
  sortOrder?: SortOrder
  showSortControls?: boolean
}

/******************* SORT CONTROLS ***********************/

interface SortControlsProps {
  basePath: string
  searchQuery?: string
  currentSort: SortOrder
  page: number
}

const SortControls: React.FC<SortControlsProps> = React.memo(function SortControls({
  basePath,
  searchQuery,
  currentSort,
  page,
}) {
  const buildHref = (sort: SortOrder): string => {
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    params.set('sort', sort)
    if (page > 1) params.set('page', String(page))
    return `${basePath}?${params.toString()}`
  }

  return (
    <div className="flex items-center gap-2 font-sans text-xs">
      <span className="text-[#666]">Sort:</span>
      {currentSort === 'desc' ? (
        <span className="text-[#121212] font-medium">Newest</span>
      ) : (
        <Link href={buildHref('desc')} className="text-[#666] underline underline-offset-2">
          Newest
        </Link>
      )}
      <span className="text-[#ccc]">|</span>
      {currentSort === 'asc' ? (
        <span className="text-[#121212] font-medium">Oldest</span>
      ) : (
        <Link href={buildHref('asc')} className="text-[#666] underline underline-offset-2">
          Oldest
        </Link>
      )}
    </div>
  )
})

/******************* MAIN COMPONENT ***********************/

export const ArticleArchive: React.FC<ArticleArchiveProps> = React.memo(function ArticleArchive({
  articles,
  page,
  totalPages,
  totalDocs,
  basePath,
  title = 'Archive',
  searchQuery,
  sortOrder = 'desc',
  showSortControls = false,
}) {
  /******************* COMPUTED ***********************/

  const buildPaginationHref = (targetPage: number): string => {
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    if (showSortControls && sortOrder) params.set('sort', sortOrder)
    params.set('page', String(targetPage))
    return `${basePath}?${params.toString()}`
  }

  const prevHref = page > 1 ? buildPaginationHref(page - 1) : null
  const nextHref = page < totalPages ? buildPaginationHref(page + 1) : null
  const pageLabel = totalPages <= 0 ? 'Page 1' : `Page ${page} of ${totalPages}`

  const resultsLabel =
    totalDocs !== undefined ? `${totalDocs} result${totalDocs === 1 ? '' : 's'}` : null

  const pageItems = (() => {
    if (totalPages <= 1) return []
    const items: Array<number | 'ellipsis'> = []
    const first = 1
    const last = totalPages
    const start = Math.max(2, page - 2)
    const end = Math.min(last - 1, page + 2)

    items.push(first)
    if (start > 2) items.push('ellipsis')
    for (let i = start; i <= end; i += 1) {
      items.push(i)
    }
    if (end < last - 1) items.push('ellipsis')
    if (last > 1) items.push(last)
    return items
  })()

  /******************* RENDER ***********************/

  return (
    <div>
      {/* Header */}
      <div className="border-b border-[#e2e2e2] pb-2">
        <div className="flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <h2 className="font-sans text-sm uppercase tracking-wider text-[#121212]">{title}</h2>
            {searchQuery && (
              <span className="font-sans text-sm text-[#666]">for &ldquo;{searchQuery}&rdquo;</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {resultsLabel && <span className="font-sans text-xs text-[#666]">{resultsLabel}</span>}
            <span className="font-sans text-xs text-[#666]">{pageLabel}</span>
          </div>
        </div>

        {/* Sort controls */}
        {showSortControls && (
          <div className="mt-2">
            <SortControls
              basePath={basePath}
              searchQuery={searchQuery}
              currentSort={sortOrder}
              page={page}
            />
          </div>
        )}
      </div>

      {/* Articles list */}
      {articles.length > 0 ? (
        <div className="divide-y divide-[#e2e2e2]">
          {articles.map((article) => (
            <div key={article.id} className="py-5">
              <ArticleCard
                article={article}
                variant="standard"
                showImage={false}
                showExcerpt
                showAuthor
                showCategory
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <p className="font-sans text-[#666]">
            {searchQuery ? 'No articles found matching your search.' : 'No articles available.'}
          </p>
        </div>
      )}

      {/* Pagination */}
      {articles.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          {prevHref ? (
            <Link
              href={prevHref}
              className="font-sans text-sm text-[#121212] underline underline-offset-4"
            >
              Previous
            </Link>
          ) : (
            <span className="font-sans text-sm text-[#999]">Previous</span>
          )}

          {pageItems.length > 0 && (
            <div className="flex items-center gap-2 font-sans text-sm">
              {pageItems.map((item, index) =>
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${index}`} className="text-[#999]">
                    …
                  </span>
                ) : item === page ? (
                  <span
                    key={item}
                    className="px-2 py-0.5 border border-[#121212] text-[#121212] font-medium"
                  >
                    {item}
                  </span>
                ) : (
                  <Link
                    key={item}
                    href={buildPaginationHref(item)}
                    className="px-2 py-0.5 text-[#121212] underline underline-offset-4"
                  >
                    {item}
                  </Link>
                ),
              )}
            </div>
          )}

          {nextHref ? (
            <Link
              href={nextHref}
              className="font-sans text-sm text-[#121212] underline underline-offset-4"
            >
              Next
            </Link>
          ) : (
            <span className="font-sans text-sm text-[#999]">Next</span>
          )}
        </div>
      )}
    </div>
  )
})
