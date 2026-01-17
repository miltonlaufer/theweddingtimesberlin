import React from 'react'
import Link from 'next/link'
import type { IArticle } from '@/types/article'
import { calculateReadingTime } from '@/lib/articles/readingTime'
import { FallbackImage } from '@/components/FallbackImage'

interface ArticleBlockProps {
  article: IArticle
  isLast: boolean
  showImage: boolean
}

export function LeftColumnArticle({ article, isLast, showImage }: ArticleBlockProps) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link key={article.id} href={`/article/${article.slug}`} className="group block">
      <article className={`pb-5 mb-5 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        {showImage && article.featuredImageUrl && (
          <div className="relative w-full aspect-[16/10] mb-3 overflow-hidden">
            <FallbackImage
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
        <p className="font-serif text-[17px] leading-[1.35] text-[#333]">{article.excerpt}</p>
        <p className="font-sans text-xs font-medium text-[#666] mt-2 uppercase tracking-wider">
          {readingTime} MIN READ
        </p>
      </article>
    </Link>
  )
}

export function HeadlineArticle({ article }: { article: IArticle }) {
  return (
    <Link href={`/article/${article.slug}`} className="group block">
      <article>
        {article.featuredImageUrl && (
          <div className="w-full aspect-[16/10] mb-3 relative overflow-hidden">
            <FallbackImage
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
          <p className="font-serif text-xl text-[#333] mb-3 leading-snug">{article.subheadline}</p>
        )}
        <p className="font-serif text-[17px] leading-[1.35] text-[#333]">{article.excerpt}</p>
        <p className="font-sans text-xs font-medium text-[#666] mt-3 uppercase tracking-wider">
          By {article.author.name}
        </p>
      </article>
    </Link>
  )
}

export function OpinionSection({ articles }: { articles: IArticle[] }) {
  if (articles.length === 0) return null

  return (
    <div className="mt-8 pt-8 border-t-2 border-[rgba(18,18,18,0.7)]">
      <h2 className="font-sans text-sm font-bold uppercase tracking-wider text-[#121212] mb-4">
        Opinion
      </h2>
      {articles.map((article, index) => (
        <div key={article.id} className={index > 0 ? 'mt-6 pt-6 border-t border-[#e2e2e2]' : ''}>
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
      ))}
    </div>
  )
}

export function CenterColumnArticle({ article, isLast, showImage }: ArticleBlockProps) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link href={`/article/${article.slug}`} className="group block">
      <article className={`pb-5 mb-5 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        {showImage && article.featuredImageUrl && (
          <div className="relative w-full aspect-[16/10] mb-3 overflow-hidden">
            <FallbackImage
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

export function SpanningArticle({ article, showImage }: { article: IArticle; showImage: boolean }) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link href={`/article/${article.slug}`} className="group block">
      <article className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 items-start">
        {showImage && article.featuredImageUrl && (
          <div className="relative w-full aspect-[16/10] overflow-hidden self-start">
            <FallbackImage
              src={article.featuredImageUrl}
              alt={article.headline}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 280px"
            />
          </div>
        )}
        <div
          className={`${showImage && article.featuredImageUrl ? '' : 'md:col-span-2'} self-start`}
        >
          <h3 className="spanning-article-title font-headline text-[28px] font-bold leading-[1.15] tracking-[-0.01em] text-[#121212] mb-3 group-hover:text-[#555] transition-colors">
            {article.headline}
          </h3>
          {article.subheadline && (
            <p className="font-serif text-lg text-[#333] mb-3 leading-snug">
              {article.subheadline}
            </p>
          )}
          <p className="font-serif text-[17px] leading-[1.35] text-[#333] mb-3">
            {article.excerpt}
          </p>
          <p className="font-sans text-xs font-medium text-[#666] uppercase tracking-wider">
            {readingTime} MIN READ
          </p>
        </div>
      </article>
    </Link>
  )
}

export function RightColumnArticle({ article, isLast, showImage }: ArticleBlockProps) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link key={article.id} href={`/article/${article.slug}`} className="group block">
      <article className={`pb-4 mb-4 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        {showImage && article.featuredImageUrl ? (
          <>
            <div className="relative w-full aspect-[16/10] mb-3 overflow-hidden">
              <FallbackImage
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
