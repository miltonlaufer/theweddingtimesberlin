import React from 'react'
import { getPayload } from '@/lib/payload'
import { NavigationClient } from './Navigation'

/******************* TYPES ***********************/

interface CategoryDoc {
  id: string | number
  name: string
  slug: string
}

interface ArticleWithCategory {
  category?: string | number | { id: string | number } | null
}

/******************* SERVER COMPONENT ***********************/

export async function NavigationServer() {
  const payload = await getPayload()

  // DB unavailable (build time) - return empty navigation
  if (!payload) {
    return <NavigationClient categories={[]} />
  }

  // Fetch categories and published articles in parallel (2 queries instead of N+1)
  const [categoriesResult, articlesResult] = await Promise.all([
    payload.find({
      collection: 'categories',
      limit: 100,
    }),
    // Fetch only the category field from published articles (minimal data)
    payload.find({
      collection: 'articles',
      where: { status: { equals: 'published' } },
      limit: 10000, // Get all published articles
      depth: 0, // Don't populate relations - we just need the category ID
      select: { category: true }, // Only fetch the category field
    }),
  ])

  // Build a map of category ID -> count
  const countByCategory = new Map<string | number, number>()
  for (const article of articlesResult.docs as ArticleWithCategory[]) {
    const catId =
      typeof article.category === 'object' && article.category !== null
        ? article.category.id
        : article.category
    if (catId != null) {
      countByCategory.set(catId, (countByCategory.get(catId) ?? 0) + 1)
    }
  }

  // Build categories with counts
  const categoriesWithCounts = (categoriesResult.docs as CategoryDoc[])
    .filter((cat) => countByCategory.has(cat.id))
    .map((cat) => ({
      name: cat.name,
      slug: cat.slug,
      count: countByCategory.get(cat.id) ?? 0,
    }))

  // Sort by article count (descending) and take top 6
  const topCategories = categoriesWithCounts
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(({ name, slug }) => ({ name, slug }))

  return <NavigationClient categories={topCategories} />
}
