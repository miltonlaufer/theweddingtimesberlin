'use client'

import React, { useMemo } from 'react'
import Link from 'next/link'
import type { IArticle } from '@/types/article'
import { FallbackImage } from '@/components/FallbackImage'

/******************* TYPES ***********************/

interface ArticleCardProps {
  article: IArticle
  variant?: 'headline' | 'featured' | 'standard' | 'compact'
  showImage?: boolean
  showExcerpt?: boolean
  showAuthor?: boolean
  showCategory?: boolean
}

/******************* COMPONENT ***********************/

export const ArticleCard: React.FC<ArticleCardProps> = React.memo(function ArticleCard({
  article,
  variant = 'standard',
  showImage = true,
  showExcerpt = true,
  showAuthor = true,
  showCategory = true,
}) {
  /******************* COMPUTED ***********************/

  const formattedDate = useMemo(() => {
    if (!article.publishedAt) return null
    return new Date(article.publishedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }, [article.publishedAt])

  const headlineClasses = useMemo(() => {
    const baseClasses = 'font-headline leading-tight article-link'
    switch (variant) {
      case 'headline':
        return `${baseClasses} text-3xl md:text-4xl lg:text-5xl font-bold`
      case 'featured':
        return `${baseClasses} text-xl md:text-2xl font-semibold`
      case 'compact':
        return `${baseClasses} text-base font-semibold`
      default:
        return `${baseClasses} text-lg md:text-xl font-semibold`
    }
  }, [variant])

  const articleUrl = useMemo(() => `/article/${article.slug}`, [article.slug])
  const categoryUrl = useMemo(() => `/section/${article.category.slug}`, [article.category.slug])

  /******************* RENDER ***********************/

  return (
    <article className={`${variant === 'headline' ? 'pb-6' : 'pb-4'}`}>
      {/* Category label */}
      {showCategory && (
        <Link href={categoryUrl}>
          <span className="font-sans text-xs uppercase tracking-wider text-[var(--color-accent-dark)] hover:underline">
            {article.category.name}
          </span>
        </Link>
      )}

      {/* Featured Image */}
      {showImage && article.featuredImageUrl && (
        <Link href={articleUrl} className="block mt-2 mb-3">
          <div
            className={`relative overflow-hidden bg-[var(--color-rule)] ${
              variant === 'headline' ? 'aspect-[16/9]' : 'aspect-[4/3]'
            }`}
          >
            <FallbackImage
              src={article.featuredImageUrl}
              alt={article.headline}
              fill
              className="object-cover transition-transform duration-300 hover:scale-105"
              sizes={variant === 'headline' ? '100vw' : '(max-width: 768px) 100vw, 50vw'}
            />
          </div>
          {article.imageCaption && (
            <p className="mt-1 text-xs text-[var(--color-ink-lighter)] font-sans italic">
              {article.imageCaption}
            </p>
          )}
        </Link>
      )}

      {/* Headline */}
      <Link href={articleUrl}>
        <h2 className={headlineClasses}>{article.headline}</h2>
      </Link>

      {/* Subheadline */}
      {article.subheadline && variant !== 'compact' && (
        <p className="mt-1 font-subhead text-lg text-[var(--color-ink-light)] italic">
          {article.subheadline}
        </p>
      )}

      {/* Excerpt */}
      {showExcerpt && article.excerpt && variant !== 'compact' && (
        <p className="mt-2 font-body text-[var(--color-ink-light)] leading-relaxed">
          {article.excerpt}
        </p>
      )}

      {/* Byline */}
      {showAuthor && (
        <div className="mt-2 flex items-center gap-2 text-xs font-sans text-[var(--color-ink-lighter)]">
          <span className="uppercase tracking-wider">By {article.author.name}</span>
          {formattedDate && (
            <>
              <span className="text-[var(--color-rule-dark)]">|</span>
              <time dateTime={article.publishedAt}>{formattedDate}</time>
            </>
          )}
        </div>
      )}
    </article>
  )
})
