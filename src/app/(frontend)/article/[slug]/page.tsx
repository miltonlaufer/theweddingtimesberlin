'use client'

import React, { useMemo } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'

/******************* MOCK DATA ***********************/

// Same mock data - will be replaced by CMS
const mockArticle = {
  id: '1',
  headline: 'Bride Declares Emergency After Discovering Aunt Karen Wore White',
  subheadline:
    'The incident has been described as "an act of war" by sources close to the wedding party',
  slug: 'aunt-karen-white-dress',
  featuredImageUrl: 'https://picsum.photos/seed/wedding1/1200/800',
  imageCaption: 'The offending garment, captured moments before the confrontation',
  content: `
    <p>In what witnesses are calling "the most predictable betrayal in the history of family gatherings," local bride Jennifer Mitchell discovered at 2:47 PM Saturday that her Aunt Karen had arrived at the ceremony wearing an ivory floor-length gown that sources describe as "aggressively bridal."</p>
    
    <p>"I saw it from across the venue," Mitchell told The Wedding Times, her voice still trembling with rage. "She walked in like she was the second coming of Princess Diana. The audacity. The absolute audacity."</p>
    
    <p>According to multiple eyewitnesses, Aunt Karen, 54, made her entrance during the pre-ceremony cocktail hour, immediately drawing gasps from several bridesmaids and one very vocal flower girl who reportedly asked, "Mommy, why are there two brides?"</p>
    
    <h3>The Aftermath</h3>
    
    <p>The incident has sent shockwaves through the extended Mitchell family, with relatives reportedly choosing sides in what some are calling "the Great Dress Schism of 2024."</p>
    
    <p>"In 47 years of wedding photography, I've never seen anything like it," said veteran photographer Marcus Chen. "The tension was so thick you could cut it with a cake knife. Which, incidentally, the bride did threaten to do at one point."</p>
    
    <p>Aunt Karen, reached for comment, defended her choice of attire. "It's not white, it's eggshell," she insisted, before adding, "Besides, I look terrible in pastels. Jennifer should have considered that when she chose her color scheme."</p>
    
    <h3>Expert Analysis</h3>
    
    <p>Dr. Helena Worthington, professor of Wedding Psychology at the University of Romance Studies, called the incident "a textbook example of attention-seeking behavior masked as fashion independence."</p>
    
    <p>"The white dress at someone else's wedding is the nuclear option of passive aggression," Dr. Worthington explained. "It's essentially saying, 'I acknowledge this is your day, but what if it wasn't?'"</p>
    
    <p>The wedding reception proceeded as scheduled, though sources report that Aunt Karen was strategically excluded from all official photographs and seated at a table near the kitchen with the groom's college roommates who "nobody really knows anymore."</p>
  `,
  excerpt:
    'In what witnesses are calling "the most predictable betrayal in the history of family gatherings," local bride Jennifer Mitchell discovered at 2:47 PM Saturday that her Aunt Karen had arrived at the ceremony wearing an ivory floor-length gown.',
  category: { id: 'c1', name: 'Breaking News', slug: 'breaking', description: '', order: 0 },
  author: {
    id: 'a1',
    name: 'Margaret Thornberry',
    slug: 'margaret-thornberry',
    title: 'Wedding Correspondent',
    bio: 'Margaret Thornberry has been covering weddings, engagements, and matrimonial disasters for over 15 years. She believes every wedding tells a story, though not always the one the couple intended.',
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

  const params = useParams()
  const _slug = params.slug as string // Will be used for fetching from CMS

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
      <div className="newspaper-container py-12 text-center">
        <h1 className="font-headline text-3xl">Article Not Found</h1>
        <p className="mt-4 text-[var(--color-ink-lighter)]">
          The article you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <Link href="/" className="mt-6 inline-block text-[var(--color-accent-dark)] hover:underline">
          Return to Homepage
        </Link>
      </div>
    )
  }

  return (
    <article className="newspaper-container py-6">
      {/* Article header */}
      <header className="max-w-3xl mx-auto">
        {/* Category */}
        <Link href={categoryUrl}>
          <span className="font-sans text-sm uppercase tracking-wider text-[var(--color-accent-dark)] hover:underline">
            {article.category.name}
          </span>
        </Link>

        {/* Headline */}
        <h1 className="font-headline text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mt-3">
          {article.headline}
        </h1>

        {/* Subheadline */}
        {article.subheadline && (
          <p className="font-subhead text-xl md:text-2xl text-[var(--color-ink-light)] italic mt-4">
            {article.subheadline}
          </p>
        )}

        {/* Byline */}
        <div className="mt-6 pt-4 rule-top flex items-center gap-4">
          <div>
            <p className="font-sans text-sm">
              By{' '}
              <Link
                href={`/author/${article.author.slug}`}
                className="font-semibold hover:text-[var(--color-accent-dark)]"
              >
                {article.author.name}
              </Link>
            </p>
            {article.author.title && (
              <p className="font-sans text-xs text-[var(--color-ink-lighter)]">{article.author.title}</p>
            )}
          </div>
          <div className="ml-auto text-right">
            {formattedDate && (
              <time
                dateTime={article.publishedAt}
                className="font-sans text-sm text-[var(--color-ink-lighter)]"
              >
                {formattedDate}
              </time>
            )}
          </div>
        </div>
      </header>

      {/* Featured image */}
      {article.featuredImageUrl && (
        <figure className="mt-8 max-w-4xl mx-auto">
          <div className="relative aspect-[16/10] overflow-hidden bg-[var(--color-rule)]">
            <Image
              src={article.featuredImageUrl}
              alt={article.headline}
              fill
              className="object-cover"
              priority
              sizes="(max-width: 768px) 100vw, 900px"
            />
          </div>
          {article.imageCaption && (
            <figcaption className="mt-2 font-sans text-sm text-[var(--color-ink-lighter)] italic">
              {article.imageCaption}
            </figcaption>
          )}
        </figure>
      )}

      {/* Article content */}
      <div className="mt-8 max-w-3xl mx-auto">
        <div
          className="prose prose-lg prose-neutral max-w-none
            prose-headings:font-headline prose-headings:text-[var(--color-ink)]
            prose-p:font-body prose-p:text-[var(--color-ink)] prose-p:leading-relaxed
            prose-a:text-[var(--color-accent-dark)] prose-a:no-underline hover:prose-a:underline
            prose-blockquote:border-l-[var(--color-accent)] prose-blockquote:italic
            prose-strong:text-[var(--color-ink)]
            first:prose-p:drop-cap"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
      </div>

      {/* Author bio */}
      {article.author.bio && (
        <aside className="mt-12 pt-6 rule-top max-w-3xl mx-auto">
          <div className="bg-[var(--color-rule)] bg-opacity-30 p-6">
            <h3 className="font-sans text-xs uppercase tracking-wider text-[var(--color-ink-lighter)] mb-2">
              About the Author
            </h3>
            <p className="font-headline text-lg font-semibold">{article.author.name}</p>
            {article.author.title && (
              <p className="font-sans text-sm text-[var(--color-accent-dark)]">{article.author.title}</p>
            )}
            <p className="mt-2 font-body text-[var(--color-ink-light)]">{article.author.bio}</p>
          </div>
        </aside>
      )}

      {/* Related articles would go here */}
    </article>
  )
}
