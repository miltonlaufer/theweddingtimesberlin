import React from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NytContainer } from '@/components/NytContainer'
import { getPayload } from '@/lib/payload'
import { getBaseUrl } from '@/lib/getBaseUrl'
import {
  mapPayloadArticleToIArticle,
  type PayloadArticleLike,
} from '@/lib/articles/mapPayloadArticleToIArticle'
import { FallbackImage } from '@/components/FallbackImage'

/******************* RENDERING CONFIG ***********************/

export const dynamicParams = true
// Articles are static once published - no time-based revalidation needed
export const revalidate = false

export async function generateStaticParams() {
  return []
}

/******************* PAGE PROPS ***********************/

interface ArticlePageProps {
  params: Promise<{ slug: string }>
}

const FALLBACK_METADATA: Metadata = {
  title: 'The Wedding Times | Berlin',
  description:
    "All the News That's Fit to Print - Berlin Wedding's Premier Satirical Neighbourhood Publication",
}

/******************* METADATA ***********************/

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  try {
    const { slug } = await params
    const baseUrl = getBaseUrl()
    const payload = await getPayload()

    if (!payload) {
      return FALLBACK_METADATA
    }

    const result = await payload.find({
      collection: 'articles',
      where: {
        slug: { equals: slug },
        status: { equals: 'published' },
      },
      depth: 2,
      limit: 1,
    })

    const article = result.docs[0]
      ? mapPayloadArticleToIArticle(result.docs[0] as PayloadArticleLike)
      : null

    if (!article) {
      return FALLBACK_METADATA
    }

    const articleUrl = `${baseUrl}/article/${article.slug}`
    const description =
      article.excerpt || article.subheadline || 'Read the full article on The Wedding Times'
    const imageUrl = article.featuredImageUrl || `${baseUrl}/logo-200x200.png`
    const fullTitle = `${article.headline} | The Wedding Times`

    return {
      title: fullTitle,
      description,
      openGraph: {
        title: fullTitle,
        description,
        type: 'article',
        locale: 'en_US',
        siteName: 'The Wedding Times',
        url: articleUrl,
        images: [
          {
            url: imageUrl,
            width: article.featuredImageUrl ? 1200 : 200,
            height: article.featuredImageUrl ? 630 : 200,
            alt: article.headline,
          },
        ],
        publishedTime: article.publishedAt,
        authors: [article.author.name],
        section: article.category.name,
      },
      twitter: {
        card: article.featuredImageUrl ? 'summary_large_image' : 'summary',
        title: fullTitle,
        description,
        images: [imageUrl],
      },
    }
  } catch {
    return FALLBACK_METADATA
  }
}

/******************* ARTICLE PAGE COMPONENT ***********************/

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params

  let payload
  try {
    payload = await getPayload()
  } catch {
    throw new Error('Payload unavailable')
  }

  if (!payload) {
    throw new Error('Payload unavailable')
  }

  let result
  try {
    result = await payload.find({
      collection: 'articles',
      where: {
        slug: { equals: slug },
        status: { equals: 'published' },
      },
      depth: 2,
      limit: 1,
    })
  } catch {
    throw new Error('Article query failed')
  }

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
    <div className="pt-20">
      <NytContainer>
        <article className="py-6">
          <header className="max-w-[680px] mx-auto">
            <Link href={categoryUrl}>
              <span className="font-sans text-sm uppercase tracking-wider text-[#666]">
                {article.category.name}
              </span>
            </Link>

            <h1 className="font-headline text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.2] mt-3 text-[#121212]">
              {article.headline}
            </h1>

            {article.subheadline && (
              <p className="font-serif text-xl md:text-2xl text-[#333] mt-6 mb-6 leading-snug">
                {article.subheadline}
              </p>
            )}

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

          {article.featuredImageUrl && (
            <figure className="mt-8 max-w-[680px] mx-auto">
              <div className="relative aspect-[16/10] overflow-hidden bg-[#e2e2e2]">
                <FallbackImage
                  src={article.featuredImageUrl}
                  alt={article.headline}
                  fill
                  className="object-cover"
                  priority
                />
              </div>
              {article.imageCaption && (
                <figcaption className="mt-2 font-sans text-sm text-[#666] italic text-right">
                  {article.imageCaption}
                </figcaption>
              )}
            </figure>
          )}

          <div className="mt-8 max-w-[680px] mx-auto">
            <div
              className="article font-serif text-xl md:text-2xl leading-relaxed text-[#121212] prose prose-lg"
              dangerouslySetInnerHTML={{ __html: article.content }}
            />
          </div>

          <footer className="mt-10 max-w-[680px] mx-auto flex items-center gap-3">
            <span className="font-sans text-sm text-[#666]">©</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/favicon.png"
              alt="The Wedding Times"
              width={32}
              height={32}
              className="object-contain"
            />
          </footer>

          {article.author.bio && (
            <aside className="mt-8 pt-6 border-t border-[rgba(18,18,18,0.7)] max-w-[680px] mx-auto">
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
    </div>
  )
}
