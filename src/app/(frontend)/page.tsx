import React from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import {
  CenterColumnArticle,
  HeadlineArticle,
  LeftColumnArticle,
  OpinionSection,
  RightColumnArticle,
  SpanningArticle,
} from '@/components/home/HomeArticleBlocks'
import { getBaseUrl } from '@/lib/getBaseUrl'
import { getPayload } from '@/lib/payload'
import {
  mapPayloadArticleToIArticle,
  type PayloadArticleLike,
} from '@/lib/articles/mapPayloadArticleToIArticle'
import { buildHomeLayout } from '@/lib/articles/homeLayout'
import type { IArticle } from '@/types/article'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'The Wedding Times | Berlin',
    description:
      "All the News That's Fit to Print - Berlin Wedding's Premier Satirical Neighbourhood Publication",
    openGraph: {
      title: 'The Wedding Times | Berlin',
      description:
        "All the News That's Fit to Print - Berlin Wedding's Premier Satirical Neighbourhood Publication",
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
      description:
        "All the News That's Fit to Print - Berlin Wedding's Premier Satirical Neighbourhood Publication",
      images: [logoUrl],
    },
  }
}

/******************* RENDERING CONFIG ***********************/

// ISR: pre-render at build time, revalidate every 24 hours
// Cache is explicitly invalidated via /api/cache/revalidate when new articles are generated
export const revalidate = 86400

/******************* HOMEPAGE COMPONENT ***********************/

export default async function HomePage() {
  // Fetch 48 non-opinion articles and 2 opinion articles separately
  const payload = await getPayload()

  if (!payload) {
    return (
      <main className="py-10 w-full">
        <NytContainer>
          <p className="font-sans text-sm text-[#666]">No published articles yet.</p>
          <Link
            href="/archive"
            className="font-sans text-sm text-[#121212] underline mt-2 inline-block"
          >
            View Archive
          </Link>
        </NytContainer>
      </main>
    )
  }

  // Fetch 48 non-opinion articles
  const nonOpinionRes = await payload.find({
    collection: 'articles',
    depth: 2,
    limit: 48,
    sort: '-publishedAt',
    where: {
      and: [
        { status: { equals: 'published' } },
        { category: { not_equals: null } }, // Ensure category exists
      ],
    },
  })

  // Get all categories to filter out opinion
  const categoriesRes = await payload.find({ collection: 'categories', limit: 100 })
  const opinionCategory = (
    categoriesRes.docs as unknown as Array<{ id: string | number; slug: string }>
  ).find((c) => c.slug === 'opinion')

  const nonOpinionArticles = (nonOpinionRes.docs as unknown as PayloadArticleLike[])
    .map(mapPayloadArticleToIArticle)
    .filter((a: IArticle) => a.category.slug !== 'opinion')

  // Fetch 2 opinion articles
  const opinionRes = await payload.find({
    collection: 'articles',
    depth: 2,
    limit: 2,
    sort: '-publishedAt',
    where: {
      and: [
        { status: { equals: 'published' } },
        ...(opinionCategory ? [{ category: { equals: opinionCategory.id } }] : []),
      ],
    },
  })

  const opinionArticles = (opinionRes.docs as unknown as PayloadArticleLike[]).map(
    mapPayloadArticleToIArticle,
  )

  if (nonOpinionArticles.length === 0 && opinionArticles.length === 0) {
    return (
      <main className="py-10 w-full">
        <NytContainer>
          <p className="font-sans text-sm text-[#666]">No published articles yet.</p>
          <Link
            href="/archive"
            className="font-sans text-sm text-[#121212] underline mt-2 inline-block"
          >
            View Archive
          </Link>
        </NytContainer>
      </main>
    )
  }

  const headlineArticle =
    nonOpinionArticles.find((a: IArticle) => a.isHeadline) ?? nonOpinionArticles[0]
  const headlineId = headlineArticle?.id

  // Only non-opinion articles go into the regular columns (excluding the headline)
  const otherArticles = nonOpinionArticles.filter((a: IArticle) => a.id !== headlineId)

  const {
    leftColumnArticles,
    centerColumnArticles,
    rightColumnArticles,
    articlesWithImages,
    leftColumnTopArticles,
    leftColumnSpanningArticle,
    leftColumnBottomArticles,
    centerColumnBeforeSpanning,
    centerColumnAfterSpanning,
  } = buildHomeLayout({ otherArticles, headlineArticle, opinionArticles })

  return (
    <main className="py-10 w-full">
      <NytContainer>
        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Main content (Left + Center) */}
          <div className="order-1 lg:border-r lg:border-[#e2e2e2] lg:pr-6">
            {/******************* MOBILE LAYOUT ***********************/}
            <div className="lg:hidden">
              {/* Center content */}
              {headlineArticle && <HeadlineArticle article={headlineArticle} />}

              {/* Opinion Section */}
              {opinionArticles.length > 0 && <OpinionSection articles={opinionArticles} />}

              {/* Additional Center Column Articles */}
              {centerColumnArticles.length > 0 && (
                <div className="mt-8 pt-8 border-t-2 border-[rgba(18,18,18,0.7)]">
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

              {/* Left column stories (all, no spanning on mobile) */}
              {leftColumnArticles.length > 0 && (
                <div className="mt-8 pt-8 border-t border-[#e2e2e2]">
                  {leftColumnArticles.map((article: IArticle, index: number) => (
                    <LeftColumnArticle
                      key={article.id}
                      article={article}
                      isLast={index === leftColumnArticles.length - 1}
                      showImage={articlesWithImages.has(String(article.id))}
                    />
                  ))}
                </div>
              )}
            </div>

            {/******************* DESKTOP LAYOUT ***********************/}
            <div className="hidden lg:grid lg:grid-cols-[280px_1fr] lg:gap-6">
              {/* Left column (top) */}
              <div className="lg:border-r lg:border-[#e2e2e2] lg:pr-6">
                {leftColumnTopArticles.map((article: IArticle, index: number) => (
                  <LeftColumnArticle
                    key={article.id}
                    article={article}
                    isLast={
                      index === leftColumnTopArticles.length - 1 &&
                      !leftColumnSpanningArticle &&
                      leftColumnBottomArticles.length === 0
                    }
                    showImage={articlesWithImages.has(String(article.id))}
                  />
                ))}
              </div>

              {/* Center column (top) */}
              <div className="lg:px-6">
                {headlineArticle && <HeadlineArticle article={headlineArticle} />}

                {/* Opinion Section */}
                {opinionArticles.length > 0 && <OpinionSection articles={opinionArticles} />}

                {/* Add a bit more center content before the spanning article to avoid a dead air gap */}
                {centerColumnBeforeSpanning.length > 0 && (
                  <div className="mt-8 pt-8 border-t-2 border-[rgba(18,18,18,0.7)]">
                    {centerColumnBeforeSpanning.map((article: IArticle, index: number) => (
                      <CenterColumnArticle
                        key={article.id}
                        article={article}
                        isLast={index === centerColumnBeforeSpanning.length - 1}
                        showImage={articlesWithImages.has(String(article.id))}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Spanning Article - 6th from left column, spans left+center */}
              {leftColumnSpanningArticle && (
                <div className="lg:col-span-2 mt-8 py-8 border-y-2 border-[rgba(18,18,18,0.7)]">
                  <SpanningArticle
                    article={leftColumnSpanningArticle}
                    showImage={articlesWithImages.has(String(leftColumnSpanningArticle.id))}
                  />
                </div>
              )}

              {/* Left column (bottom) */}
              <div className="lg:border-r lg:border-[#e2e2e2] lg:pr-6">
                {leftColumnBottomArticles.map((article: IArticle, index: number) => (
                  <LeftColumnArticle
                    key={article.id}
                    article={article}
                    isLast={index === leftColumnBottomArticles.length - 1}
                    showImage={articlesWithImages.has(String(article.id))}
                  />
                ))}
              </div>

              {/* Center column (bottom) */}
              <div className="lg:px-6">
                {centerColumnAfterSpanning.length > 0 && (
                  <div
                    className={
                      leftColumnSpanningArticle
                        ? 'mt-8'
                        : 'mt-8 pt-8 border-t-2 border-[rgba(18,18,18,0.7)]'
                    }
                  >
                    {centerColumnAfterSpanning.map((article: IArticle, index: number) => (
                      <CenterColumnArticle
                        key={article.id}
                        article={article}
                        isLast={index === centerColumnAfterSpanning.length - 1}
                        showImage={articlesWithImages.has(String(article.id))}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - More Stories */}
          <div className="order-2 lg:pl-6">
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
