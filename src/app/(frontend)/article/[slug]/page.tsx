import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NytContainer } from '@/components/NytContainer'
import { getPayload } from '@/lib/payload'
import {
  mapPayloadArticleToIArticle,
  type PayloadArticleLike,
} from '@/lib/articles/mapPayloadArticleToIArticle'

/******************* RENDERING CONFIG ***********************/

// Don't pre-render at build time, but allow static generation at runtime (ISR)
export const dynamicParams = true
export const revalidate = 3600 // Revalidate every hour

// Return empty array = no build-time generation, pages generated on first request
export async function generateStaticParams() {
  return []
}

/******************* PAGE PROPS ***********************/

interface ArticlePageProps {
  params: Promise<{ slug: string }>
}

/******************* ARTICLE PAGE COMPONENT ***********************/

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params

  const payload = await getPayload()

  const result = await payload.find({
    collection: 'articles',
    where: {
      slug: { equals: slug },
      status: { equals: 'published' },
    },
    depth: 2,
    limit: 1,
  })

  if (result.docs.length === 0) {
    notFound()
  }

  const article = mapPayloadArticleToIArticle(result.docs[0] as PayloadArticleLike)

  const formattedDate = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  const categoryUrl = `/section/${article.category.slug}`

  return (
    <NytContainer>
      <article className="py-6">
        {/* Article header */}
        <header className="max-w-[680px] mx-auto">
          {/* Category */}
          <Link href={categoryUrl}>
            <span className="font-sans text-sm uppercase tracking-wider text-[#666]">
              {article.category.name}
            </span>
          </Link>

          {/* Headline */}
          <h1 className="font-headline text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mt-3 text-[#121212]">
            {article.headline}
          </h1>

          {/* Subheadline */}
          {article.subheadline && (
            <p className="font-serif text-xl md:text-2xl text-[#333] mt-4">
              {article.subheadline}
            </p>
          )}

          {/* Byline */}
          <div className="mt-6 pt-4 border-t border-[rgba(18,18,18,0.7)] flex items-center gap-4">
            <div>
              <p className="font-sans text-sm text-[#121212]">
                By{' '}
                <Link href={`/author/${article.author.slug}`} className="font-semibold">
                  {article.author.name}
                </Link>
              </p>
              {article.author.title && (
                <p className="font-sans text-xs text-[#666]">{article.author.title}</p>
              )}
            </div>
            <div className="ml-auto text-right">
              {formattedDate && (
                <time dateTime={article.publishedAt} className="font-sans text-sm text-[#666]">
                  {formattedDate}
                </time>
              )}
            </div>
          </div>
        </header>

        {/* Featured image */}
        {article.featuredImageUrl && (
          <figure className="mt-8 max-w-[680px] mx-auto">
            <div className="relative aspect-[16/10] overflow-hidden bg-[#e2e2e2]">
              <Image
                src={article.featuredImageUrl}
                alt={article.headline}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 680px"
              />
            </div>
            {article.imageCaption && (
              <figcaption className="mt-2 font-sans text-sm text-[#666] italic text-right">
                {article.imageCaption}
              </figcaption>
            )}
          </figure>
        )}

        {/* Article content */}
        <div className="mt-8 max-w-[680px] mx-auto">
          <div
            className="font-serif text-xl leading-relaxed text-[#121212] prose prose-lg"
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
        </div>

        {/* Author bio */}
        {article.author.bio && (
          <aside className="mt-12 pt-6 border-t border-[rgba(18,18,18,0.7)] max-w-[680px] mx-auto">
            <div className="bg-[#e2e2e2]/30 p-6">
              <h3 className="font-sans text-xs uppercase tracking-wider text-[#666] mb-2">
                About the Author
              </h3>
              <p className="font-headline text-lg font-semibold text-[#121212]">
                {article.author.name}
              </p>
              {article.author.title && (
                <p className="font-sans text-sm text-[#333]">{article.author.title}</p>
              )}
              <p className="mt-2 font-sans text-[#333]">{article.author.bio}</p>
            </div>
          </aside>
        )}
      </article>
    </NytContainer>
  )
}
