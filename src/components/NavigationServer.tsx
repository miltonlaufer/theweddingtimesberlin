import React from 'react'
import { getPayload } from '@/lib/payload'
import { NavigationClient } from './Navigation'

/******************* SERVER COMPONENT ***********************/

export async function NavigationServer() {
  const payload = await getPayload()

  // DB unavailable (build time) - return empty navigation
  if (!payload) {
    return <NavigationClient categories={[]} />
  }

  // Fetch all categories
  const categoriesResult = await payload.find({
    collection: 'categories',
    limit: 50,
    sort: 'order',
  })

  // For each category, count published articles
  const categoriesWithCounts: Array<{ name: string; slug: string; count: number }> = []

  for (const category of categoriesResult.docs) {
    const articlesResult = await payload.find({
      collection: 'articles',
      where: {
        category: { equals: category.id },
        status: { equals: 'published' },
      },
      limit: 0, // We only need the count, not the docs
    })

    if (articlesResult.totalDocs > 0) {
      categoriesWithCounts.push({
        name: category.name,
        slug: category.slug,
        count: articlesResult.totalDocs,
      })
    }
  }

  // Sort by article count (descending) and take top 6
  const topCategories = categoriesWithCounts
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(({ name, slug }) => ({ name, slug }))

  return <NavigationClient categories={topCategories} />
}
