'use client'

import React, { useMemo } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { NytContainer } from '@/components/NytContainer'

/******************* MOCK DATA ***********************/

// Same mock data - will be replaced by CMS
const mockArticle = {
  id: '1',
  headline: 'Buergeramt Appointment Secured for 2027 After 3-Year Wait',
  subheadline: 'Local resident celebrates bureaucratic victory, plans to finally register address',
  slug: 'buergeramt-2027',
  featuredImageUrl: 'https://picsum.photos/seed/bureaucracy1/1200/800',
  imageCaption: 'Photo by Wedding Bureaucracy Watch',
  content: `
    <p>In a landmark achievement for patience and perseverance, a Wedding resident has finally secured an appointment at the local Buergeramt for their Anmeldung, scheduled for the spring of 2027.</p>
    <p>The resident, who began their application process in 2024, expressed &quot;cautious optimism&quot; about the upcoming registration. &quot;I&apos;ve learned German, started a business, and memorized the BVG strike calendar. Now I just need the stamp.&quot;</p>
    <p>City officials described the backlog as &quot;a testament to Berlin&apos;s enduring popularity&quot; and encouraged residents to &quot;embrace the unique charm of delayed gratification.&quot;</p>
    <h3>Practical Advice</h3>
    <p>Experts recommend arriving early, bringing a book, and preparing your documents in triplicate. If your appointment is canceled, simply try again in 2029.</p>
  `,
  excerpt:
    'In a landmark achievement for patience and perseverance, a Wedding resident has finally secured an appointment at the local Buergeramt for their Anmeldung, scheduled for the spring of 2027.',
  category: { id: 'c1', name: 'Bureaucracy', slug: 'bureaucracy', description: '', order: 0 },
  author: {
    id: 'a1',
    name: 'Greta Schmidt',
    slug: 'greta-schmidt',
    title: 'Bureaucracy Correspondent',
    bio: 'Greta Schmidt covers the sacred rituals of bureaucracy, queueing, and paperwork in Wedding.',
  },
  publishedAt: new Date().toISOString(),
  status: 'published' as const,
  isFeatured: false,
  isHeadline: true,
  layout: 'standard' as const,
}

/******************* ARTICLE PAGE COMPONENT ***********************/

export default function ArticlePage() {
  /******************* STORE ***********************/

  useParams()

  /******************* COMPUTED ***********************/

  // In production, fetch article by slug from store/CMS
  const article = useMemo(() => {
    // For now, return mock data - in production, use _slug to fetch
    return mockArticle
  }, [])

  const formattedDate = useMemo(() => {
    if (!article.publishedAt) return null
    return new Date(article.publishedAt).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }, [article.publishedAt])

  const categoryUrl = useMemo(() => `/section/${article.category.slug}`, [article.category.slug])

  /******************* RENDER ***********************/

  if (!article) {
    return (
      <NytContainer className="py-12 text-center">
        <h1 className="font-headline text-3xl">Article Not Found</h1>
        <p className="mt-4 text-[#666]">
          The article you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <Link href="/" className="mt-6 inline-block text-[#121212]">
          Return to Homepage
        </Link>
      </NytContainer>
    )
  }

  return (
    <NytContainer className="py-6">
      <article>
        {/* Article header */}
        <header className="max-w-[720px] mx-auto">
          {/* Category */}
          <Link href={categoryUrl}>
            <span className="font-sans text-sm uppercase tracking-wider text-[#666]">
              {article.category.name}
            </span>
          </Link>

          {/* Headline */}
          <h1 className="font-headline italic text-3xl md:text-4xl lg:text-5xl font-semibold leading-[1.03] mt-3 text-[#121212]">
            {article.headline}
          </h1>

          {/* Subheadline */}
          {article.subheadline && (
            <p className="font-serif text-xl md:text-2xl text-[#333] mt-4 leading-snug">
              {article.subheadline}
            </p>
          )}

          {/* Byline */}
          <div className="mt-6 pt-4 border-t border-[#e2e2e2] flex items-center gap-4">
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
          <figure className="mt-8 max-w-[720px] mx-auto">
            <div className="relative aspect-[16/10] overflow-hidden bg-[#e2e2e2]">
              <Image
                src={article.featuredImageUrl}
                alt={article.headline}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 720px"
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
        <div className="mt-8 max-w-[720px] mx-auto">
          <div
            className="font-article text-[20px] leading-[1.7] text-[#121212]"
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
        </div>

        {/* Author bio */}
        {article.author.bio && (
          <aside className="mt-12 pt-6 border-t border-[#e2e2e2] max-w-[720px] mx-auto">
            <div className="bg-[#e2e2e2]/30 p-6">
              <h3 className="font-sans text-xs uppercase tracking-wider text-[#666] mb-2">
                About the Author
              </h3>
              <p className="font-headline text-lg font-semibold text-[#121212]">{article.author.name}</p>
              {article.author.title && (
                <p className="font-sans text-sm text-[#333]">{article.author.title}</p>
              )}
              <p className="mt-2 font-sans text-[#333]">{article.author.bio}</p>
            </div>
          </aside>
        )}

        {/* Related articles would go here */}
      </article>
    </NytContainer>
  )
}
