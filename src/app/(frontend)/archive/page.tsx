import React from 'react'
import { NytContainer } from '@/components/NytContainer'
import { ArticleArchive } from '@/components/ArticleArchive'
import { fetchPublishedArticles } from '@/lib/articles/fetchPublishedArticles'

/******************* ISR ***********************/

export const revalidate = 3600

/******************* PAGE ***********************/

export default async function ArchivePage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const rawPage = resolvedSearchParams?.page
  const page = rawPage ? Math.max(1, Math.floor(Number(rawPage) || 1)) : 1

  const res = await fetchPublishedArticles({ limit: 20, page })

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

