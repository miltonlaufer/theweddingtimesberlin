import React from 'react'
import { NytContainer } from '@/components/NytContainer'
import { ArticleArchive } from '@/components/ArticleArchive'
import { fetchPublishedArticles } from '@/lib/articles/fetchPublishedArticles'

/******************* RENDERING CONFIG ***********************/

// ISR: pre-render at build time, revalidate every 20 minutes
export const revalidate = 1200

/******************* PAGE ***********************/

export default async function ArchivePage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const rawPage = resolvedSearchParams?.page
  const page = rawPage ? Math.max(1, Math.floor(Number(rawPage) || 1)) : 1

  // Handle build-time when DB is unavailable
  const res = await fetchPublishedArticles({ limit: 20, page }).catch(() => ({
    articles: [],
    page: 1,
    totalPages: 1,
  }))

  return (
    <NytContainer className="py-8">
      <ArticleArchive
        articles={res.articles}
        page={res.page}
        totalPages={res.totalPages}
        basePath="/archive"
      />
    </NytContainer>
  )
}

