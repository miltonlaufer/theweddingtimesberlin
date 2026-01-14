import React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { NytContainer } from '@/components/NytContainer'
import { fetchPublishedArticles } from '@/lib/articles/fetchPublishedArticles'
import type { IArticle } from '@/types/article'

/******************* HELPERS ***********************/

function calculateReadingTime(content: string): number {
  // Strip HTML tags and count words
  const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const wordCount = text.split(' ').filter((w) => w.length > 0).length
  // Average reading speed: 200 words per minute, minimum 1 minute
  return Math.max(1, Math.ceil(wordCount / 200))
}

/******************* RENDERING CONFIG ***********************/

// ISR: static at runtime, revalidate hourly
export const revalidate = 3600

/******************* HOMEPAGE COMPONENT ***********************/

export default async function HomePage() {
  // Wrap in try/catch to handle build-time when DB is unavailable
  let articles: IArticle[] = []
  try {
    const result = await fetchPublishedArticles({ limit: 40 })
    articles = result.articles
  } catch {
    // DB unavailable (build time) - render empty state, will be filled on first request
  }

  if (articles.length === 0) {
    return (
      <main className="py-10 w-full">
        <NytContainer>
          <p className="font-sans text-sm text-[#666]">No published articles yet.</p>
          <Link href="/archive" className="font-sans text-sm text-[#121212] underline mt-2 inline-block">
            View Archive
          </Link>
        </NytContainer>
      </main>
    )
  }

  const headlineArticle = articles.find((a: IArticle) => a.isHeadline) ?? articles[0]
  const opinionArticle = articles.find((a: IArticle) => a.category.slug === 'opinion' && a.id !== headlineArticle?.id)

  const headlineId = headlineArticle?.id
  const opinionId = opinionArticle?.id
  const otherArticles = articles.filter((a: IArticle) => a.id !== headlineId && a.id !== opinionId)

  const leftColumnArticles = otherArticles.slice(0, 3)
  const rightColumnArticles = otherArticles.slice(3, 9) // More compact = more articles

  return (
    <main className="py-10 w-full">
      <NytContainer>
        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-6">
          {/* Left Column - Secondary Stories */}
          <div className="order-2 lg:order-1 lg:border-r lg:border-[#e2e2e2] lg:pr-6">
            {leftColumnArticles.map((article: IArticle, index: number) => (
              <LeftColumnArticle
                key={article.id}
                article={article}
                isLast={index === leftColumnArticles.length - 1}
              />
            ))}
          </div>

          {/* Center Column - Main Headline */}
          <div className="order-1 lg:order-2 lg:px-6 lg:border-r lg:border-[#e2e2e2]">
            {headlineArticle && <HeadlineArticle article={headlineArticle} />}

            {/* Opinion Section */}
            {opinionArticle && <OpinionSection article={opinionArticle} />}
          </div>

          {/* Right Column - More Stories */}
          <div className="order-3 lg:pl-6">
            <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-[#121212] pb-2 mb-4 border-b border-[#e2e2e2]">
              More News
            </h2>
            {rightColumnArticles.map((article: IArticle, index: number) => (
              <RightColumnArticle
                key={article.id}
                article={article}
                isLast={index === rightColumnArticles.length - 1}
                showImage={index === 0}
              />
            ))}
          </div>
        </div>
      </NytContainer>
    </main>
  )
}

/******************* SUB-COMPONENTS ***********************/

function LeftColumnArticle({ article, isLast }: { article: IArticle; isLast: boolean }) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link key={article.id} href={`/article/${article.slug}`} className="group block">
      <article className={`pb-5 mb-5 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        <h3 className="font-headline text-[26px] font-bold leading-[1.15] tracking-[-0.01em] text-[#121212] mb-2 group-hover:text-[#555] transition-colors">
          {article.headline}
        </h3>
        <p className="font-serif text-[17px] leading-[1.35] text-[#333] line-clamp-3">
          {article.excerpt}
        </p>
        <p className="font-sans text-xs font-medium text-[#666] mt-2 uppercase tracking-wider">
          {readingTime} MIN READ
        </p>
      </article>
    </Link>
  )
}

function HeadlineArticle({ article }: { article: IArticle }) {
  return (
    <Link href={`/article/${article.slug}`} className="group block">
      <article>
        {article.featuredImageUrl && (
          <div className="w-full aspect-[16/10] mb-3 relative overflow-hidden">
            <Image
              src={article.featuredImageUrl}
              alt={article.headline}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              priority
              sizes="(max-width: 768px) 100vw, 600px"
            />
          </div>
        )}
        <h2 className="font-headline text-[40px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-3 group-hover:text-[#555] transition-colors">
          {article.headline}
        </h2>
        {article.subheadline && (
          <p className="font-serif text-xl text-[#333] mb-3 leading-snug">
            {article.subheadline}
          </p>
        )}
        <p className="font-serif text-[17px] leading-[1.35] text-[#333] line-clamp-4">
          {article.excerpt}
        </p>
        <p className="font-sans text-xs font-medium text-[#666] mt-3 uppercase tracking-wider">
          By {article.author.name}
        </p>
      </article>
    </Link>
  )
}

function OpinionSection({ article }: { article: IArticle }) {
  return (
    <div className="mt-8 pt-8 border-t-2 border-[rgba(18,18,18,0.7)]">
      <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-[#121212] mb-4">
        Opinion
      </h2>
      <Link href={`/article/${article.slug}`} className="group block">
        <article>
          <h3 className="font-headline text-[22px] font-semibold leading-[1.2] text-[#121212] mb-2 group-hover:text-[#555] transition-colors">
            {article.headline}
          </h3>
          <p className="font-serif text-[17px] leading-[1.35] text-[#333] line-clamp-3 mb-2">
            {article.excerpt}
          </p>
          <p className="font-sans text-sm text-[#333]">
            By {article.author.name}
            {article.author.title && (
              <span className="text-[#666]">, {article.author.title}</span>
            )}
          </p>
        </article>
      </Link>
    </div>
  )
}

function RightColumnArticle({
  article,
  isLast,
  showImage,
}: {
  article: IArticle
  isLast: boolean
  showImage: boolean
}) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link key={article.id} href={`/article/${article.slug}`} className="group block">
      <article className={`pb-4 mb-4 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        {showImage && article.featuredImageUrl ? (
          // First article: image on top
          <>
            <div className="relative w-full aspect-[16/10] mb-3 overflow-hidden">
              <Image
                src={article.featuredImageUrl}
                alt={article.headline}
                fill
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                sizes="320px"
              />
            </div>
            <h3 className="font-headline text-[18px] font-semibold leading-[1.2] tracking-[-0.01em] text-[#121212] group-hover:text-[#555] transition-colors">
              {article.headline}
            </h3>
          </>
        ) : (
          // Other articles: compact text-only
          <>
            <h3 className="font-headline text-[16px] font-semibold leading-[1.2] tracking-[-0.01em] text-[#121212] group-hover:text-[#555] transition-colors">
              {article.headline}
            </h3>
            <p className="font-sans text-xs text-[#666] mt-1 uppercase tracking-wider">
              {readingTime} MIN READ
            </p>
          </>
        )}
      </article>
    </Link>
  )
}
