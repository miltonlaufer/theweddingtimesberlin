import React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { fetchPublishedArticles } from '@/lib/articles/fetchPublishedArticles'
import { getBaseUrl } from '@/lib/getBaseUrl'
import type { IArticle } from '@/types/article'

/******************* HELPERS ***********************/

function calculateReadingTime(content: string): number {
  // Strip HTML tags and count words
  const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const wordCount = text.split(' ').filter((w) => w.length > 0).length
  // Average reading speed: 200 words per minute, minimum 1 minute
  return Math.max(1, Math.ceil(wordCount / 200))
}

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`
  
  return {
    title: 'The Wedding Times | Berlin',
    description: "All the News That's Fit to Print - Berlin Wedding's Premier Satirical Neighbourhood Publication",
    openGraph: {
      title: 'The Wedding Times | Berlin',
      description: "All the News That's Fit to Print - Berlin Wedding's Premier Satirical Neighbourhood Publication",
      type: 'website',
      locale: 'en_US',
      siteName: 'The Wedding Times',
      url: baseUrl,
      images: [
        {
          url: logoUrl,
          width: 200,
          height: 200,
          alt: 'The Wedding Times',
        },
      ],
    },
    twitter: {
      card: 'summary',
      title: 'The Wedding Times | Berlin',
      description: "All the News That's Fit to Print - Berlin Wedding's Premier Satirical Neighbourhood Publication",
      images: [logoUrl],
    },
  }
}

/******************* RENDERING CONFIG ***********************/

// ISR: pre-render at build time, revalidate every 20 minutes
export const revalidate = 1200

/******************* HOMEPAGE COMPONENT ***********************/

export default async function HomePage() {
  const { articles } = await fetchPublishedArticles({ limit: 50 })

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

  // Separate opinion articles from regular articles FIRST
  const allOpinionArticles = articles.filter((a: IArticle) => a.category.slug === 'opinion')
  const nonOpinionArticles = articles.filter((a: IArticle) => a.category.slug !== 'opinion')

  const headlineArticle = nonOpinionArticles.find((a: IArticle) => a.isHeadline) ?? nonOpinionArticles[0]
  const opinionArticle = allOpinionArticles[0] // Show latest opinion article in the Opinion section

  const headlineId = headlineArticle?.id
  
  // Only non-opinion articles go into the regular columns (excluding the headline)
  const otherArticles = nonOpinionArticles.filter((a: IArticle) => a.id !== headlineId)

  // Distribution ratio: Left:Center:Right = 12:14:24
  // Calculate based on DISTRIBUTABLE articles (non-opinion, non-headline)
  const distributableCount = otherArticles.length
  const ratioTotal = 12 + 14 + 24 // 50
  
  // Calculate distribution based on ratio (proportional)
  const leftCount = Math.round((distributableCount * 12) / ratioTotal)
  const centerRegularCount = Math.round((distributableCount * 14) / ratioTotal)
  // Right column gets all remaining articles (slice to end)
  
  // Distribute remaining articles
  const leftColumnArticles = otherArticles.slice(0, leftCount)
  const centerColumnArticles = otherArticles.slice(leftCount, leftCount + centerRegularCount)
  const rightColumnArticles = otherArticles.slice(leftCount + centerRegularCount)

  // Randomly decide which articles show photos (3/5 chance for left/right columns)
  // Center column articles always show images if available
  const articlesWithImages = new Set<string>()
  
  // Helper to normalize article ID to string
  const normalizeId = (id: string | number): string => String(id)
  
  // Center column articles always show images
  centerColumnArticles.forEach((article) => {
    if (article.featuredImageUrl) {
      articlesWithImages.add(normalizeId(article.id))
    }
  })
  
  // Headline and opinion always show images if available
  if (headlineArticle?.featuredImageUrl) {
    articlesWithImages.add(normalizeId(headlineArticle.id))
  }
  if (opinionArticle?.featuredImageUrl) {
    articlesWithImages.add(normalizeId(opinionArticle.id))
  }
  
  // Left column: show images for 4/5 of articles (80%) to ensure more images
  leftColumnArticles.forEach((article) => {
    if (article.featuredImageUrl) {
      // Simple hash-based selection (deterministic but appears random)
      const idStr = normalizeId(article.id)
      const hash = idStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      if ((hash % 5) < 4) {
        // 4 out of 5 chance (80%)
        articlesWithImages.add(idStr)
      }
    }
  })
  
  // Right column: show images for all articles that have them (or at least first 3)
  rightColumnArticles.forEach((article, index) => {
    if (article.featuredImageUrl) {
      // Show images for first 3 articles, then 3/5 chance for others
      if (index < 3) {
        articlesWithImages.add(normalizeId(article.id))
      } else {
        const idStr = normalizeId(article.id)
        const hash = idStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
        if ((hash % 5) < 3) {
          // 3 out of 5 chance (60%) for articles after the first 3
          articlesWithImages.add(idStr)
        }
      }
    }
  })

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
                showImage={articlesWithImages.has(String(article.id))}
              />
            ))}
          </div>

          {/* Center Column - Main Headline */}
          <div className="order-1 lg:order-2 lg:px-6 lg:border-r lg:border-[#e2e2e2]">
            {headlineArticle && <HeadlineArticle article={headlineArticle} />}

            {/* Opinion Section */}
            {opinionArticle && <OpinionSection article={opinionArticle} />}

            {/* Additional Center Column Articles */}
            {centerColumnArticles.length > 0 && (
              <div className="mt-8 pt-8 border-t border-[#e2e2e2]">
                {centerColumnArticles.map((article: IArticle, index: number) => (
                  <CenterColumnArticle
                    key={article.id}
                    article={article}
                    isLast={index === centerColumnArticles.length - 1}
                    showImage={articlesWithImages.has(String(article.id))}
                  />
                ))}
              </div>
            )}
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
                showImage={articlesWithImages.has(String(article.id))}
              />
            ))}
          </div>
        </div>
      </NytContainer>
    </main>
  )
}

/******************* SUB-COMPONENTS ***********************/

function LeftColumnArticle({
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
      <article className={`pb-5 mb-5 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        {showImage && article.featuredImageUrl && (
          <div className="relative w-full aspect-[16/10] mb-3 overflow-hidden">
            <Image
              src={article.featuredImageUrl}
              alt={article.headline}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 280px"
            />
          </div>
        )}
        <h3 className="font-headline text-[26px] font-bold leading-[1.15] tracking-[-0.01em] text-[#121212] mb-2 group-hover:text-[#555] transition-colors">
          {article.headline}
        </h3>
        <p className="font-serif text-[17px] leading-[1.35] text-[#333]">
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
        <p className="font-serif text-[17px] leading-[1.35] text-[#333]">
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
          <p className="font-serif text-[17px] leading-[1.35] text-[#333] mb-2">
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

function CenterColumnArticle({
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
    <Link href={`/article/${article.slug}`} className="group block">
      <article className={`pb-5 mb-5 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        {showImage && article.featuredImageUrl && (
          <div className="relative w-full aspect-[16/10] mb-3 overflow-hidden">
            <Image
              src={article.featuredImageUrl}
              alt={article.headline}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 600px"
            />
          </div>
        )}
        <h3 className="font-headline text-[24px] font-bold leading-[1.15] tracking-[-0.01em] text-[#121212] mb-2 group-hover:text-[#555] transition-colors">
          {article.headline}
        </h3>
        {article.excerpt && (
          <p className="font-serif text-[17px] leading-[1.35] text-[#333] mb-2">
            {article.excerpt}
          </p>
        )}
        <p className="font-sans text-xs font-medium text-[#666] uppercase tracking-wider">
          {readingTime} MIN READ
        </p>
      </article>
    </Link>
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
