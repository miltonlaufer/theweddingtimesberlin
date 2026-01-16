import React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { NytContainer } from '@/components/NytContainer'
import { getPayload } from '@/lib/payload'
import {
  mapPayloadArticleToIArticle,
  type PayloadArticleLike,
} from '@/lib/articles/mapPayloadArticleToIArticle'
import { calculateReadingTime } from '@/lib/articles/readingTime'
import type { IArticle } from '@/types/article'

/******************* RENDERING CONFIG ***********************/

// Don't pre-render at build time, but allow static generation at runtime (ISR)
export const dynamicParams = true
export const revalidate = 3600 // Revalidate every hour

// Return empty array = no build-time generation, pages generated on first request
export async function generateStaticParams() {
  return []
}

/******************* PAGE PROPS ***********************/

interface SectionPageProps {
  params: Promise<{ slug: string }>
}

/******************* SECTION PAGE ***********************/

export default async function SectionPage({ params }: SectionPageProps) {
  const { slug } = await params

  const payload = await getPayload()

  // DB unavailable (build time) - will be generated on first request
  if (!payload) {
    notFound()
  }

  // Find the category
  const categoryResult = await payload.find({
    collection: 'categories',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (categoryResult.docs.length === 0) {
    notFound()
  }

  const category = categoryResult.docs[0] as {
    id: string
    name: string
    slug: string
    description?: string
  }

  // Find articles in this category
  const articlesResult = await payload.find({
    collection: 'articles',
    where: {
      category: { equals: category.id },
      status: { equals: 'published' },
    },
    depth: 2,
    limit: 40,
    sort: '-publishedAt',
  })

  const articles = articlesResult.docs.map((doc) =>
    mapPayloadArticleToIArticle(doc as PayloadArticleLike),
  )

  return (
    <main className="py-10">
      <NytContainer>
        {/* Section Header */}
        <div className="border-b-2 border-[#121212] pb-2 mb-8">
          <h1 className="font-sans text-3xl font-bold uppercase tracking-wider text-[#121212]">
            {category.name}
          </h1>
          {category.description && (
            <p className="font-serif text-lg text-[#666] mt-2">{category.description}</p>
          )}
        </div>

        {/* Articles */}
        {articles.length === 0 ? (
          <p className="font-sans text-[#666]">No articles in this section yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )}
      </NytContainer>
    </main>
  )
}

/******************* ARTICLE CARD ***********************/

function ArticleCard({ article }: { article: IArticle }) {
  const readingTime = calculateReadingTime(article.content)

  return (
    <Link href={`/article/${article.slug}`} className="group block">
      <article>
        {article.featuredImageUrl && (
          <div className="relative w-full aspect-[16/10] mb-3 overflow-hidden">
            <Image
              src={article.featuredImageUrl}
              alt={article.headline}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          </div>
        )}
        <h2 className="font-headline text-xl font-semibold leading-tight text-[#121212] group-hover:text-[#555] transition-colors mb-2">
          {article.headline}
        </h2>
        {article.excerpt && (
          <p className="font-serif text-[15px] leading-relaxed text-[#333] mb-2">
            {article.excerpt}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs font-sans text-[#666]">
          <span className="uppercase tracking-wider">{article.author.name}</span>
          <span>·</span>
          <span>{readingTime} MIN READ</span>
        </div>
      </article>
    </Link>
  )
}
