import React from 'react'
import Link from 'next/link'
import { ArticleCard } from '@/components/ArticleCard'
import type { IArticle } from '@/types/article'

/******************* TYPES ***********************/

interface ArticleArchiveProps {
  articles: IArticle[]
  page: number
  totalPages: number
  basePath: string
}

/******************* MAIN COMPONENT ***********************/

export const ArticleArchive: React.FC<ArticleArchiveProps> = React.memo(function ArticleArchive({
  articles,
  page,
  totalPages,
  basePath,
}) {
  /******************* COMPUTED ***********************/

  const prevHref = page > 1 ? `${basePath}?page=${page - 1}` : null
  const nextHref = page < totalPages ? `${basePath}?page=${page + 1}` : null
  const pageLabel = totalPages <= 0 ? 'Page 1' : `Page ${page} of ${totalPages}`

  /******************* RENDER ***********************/

  return (
    <div>
      <div className="flex items-baseline justify-between gap-6 border-b border-[#e2e2e2] pb-2">
        <h2 className="font-sans text-sm uppercase tracking-wider text-[#121212]">Archive</h2>
        <div className="font-sans text-xs text-[#666]">{pageLabel}</div>
      </div>

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

      <div className="mt-8 flex items-center justify-between gap-4">
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
    </div>
  )
})

