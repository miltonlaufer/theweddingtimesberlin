import React from 'react'
import { getPayload } from '@/lib/payload'
import { isNextProductionBuild } from '@/lib/nextPhase'
import { Footer } from './Footer'

/******************* SERVER COMPONENT ***********************/

type ArticleWithCategory = {
  category?: string | number | { id?: string | number | null } | null
}

export async function FooterServer() {
  if (isNextProductionBuild()) {
    return <Footer categories={[]} />
  }

  const payload = await getPayload()

  // DB unavailable (build time) - return footer with empty categories
  if (!payload) {
    return <Footer categories={[]} />
  }

  let categoriesWithArticles: Array<{ name: string; slug: string }>
  try {
    const [categoriesResult, articlesResult] = await Promise.all([
      payload.find({
        collection: 'categories',
        limit: 50,
        sort: 'order',
      }),
      payload.find({
        collection: 'articles',
        where: { status: { equals: 'published' } },
        limit: 10000,
        depth: 0,
        select: { category: true },
      }),
    ])

    const categoryIdsWithArticles = new Set<string>()
    for (const article of articlesResult.docs as ArticleWithCategory[]) {
      const relation = article.category
      const categoryId = typeof relation === 'object' && relation !== null ? relation.id : relation
      if (categoryId != null) {
        categoryIdsWithArticles.add(String(categoryId))
      }
    }

    categoriesWithArticles = categoriesResult.docs
      .filter((category) => categoryIdsWithArticles.has(String(category.id)))
      .map((category) => ({
        name: category.name,
        slug: category.slug,
      }))
  } catch (error) {
    console.warn('[FooterServer] Failed to load footer categories', error)
    categoriesWithArticles = []
  }

  return <Footer categories={categoriesWithArticles} />
}
