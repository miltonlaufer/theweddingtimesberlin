import React from 'react'
import { getPayload } from '@/lib/payload'
import { NavigationClient } from './Navigation'

/******************* SERVER COMPONENT ***********************/

export async function NavigationServer() {
  const payload = await getPayload()

  // Fetch all categories
  const categoriesResult = await payload.find({
    collection: 'categories',
    limit: 50,
    sort: 'order',
  })

  // For each category, check if it has at least one published article
  const categoriesWithArticles: Array<{ name: string; slug: string }> = []

  for (const category of categoriesResult.docs) {
    const articlesResult = await payload.find({
      collection: 'articles',
      where: {
        category: { equals: category.id },
        status: { equals: 'published' },
      },
      limit: 1,
    })

    if (articlesResult.totalDocs > 0) {
      categoriesWithArticles.push({
        name: category.name,
        slug: category.slug,
      })
    }
  }

  return <NavigationClient categories={categoriesWithArticles} />
}
