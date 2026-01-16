import React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { ArticleHeightMeasurer } from '@/components/ArticleHeightMeasurer'
import { getBaseUrl } from '@/lib/getBaseUrl'
import { getPayload } from '@/lib/payload'
import { mapPayloadArticleToIArticle, type PayloadArticleLike } from '@/lib/articles/mapPayloadArticleToIArticle'
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
  // Debug timestamp (static value for server component - timestamp not critical for debugging)
  const debugTimestamp = 0
  
  // Fetch 48 non-opinion articles and 2 opinion articles separately
  const payload = await getPayload()

  if (!payload) {
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
  const opinionCategory = (categoriesRes.docs as unknown as Array<{ id: string | number; slug: string }>).find((c) => c.slug === 'opinion')

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

  const opinionArticles = (opinionRes.docs as unknown as PayloadArticleLike[]).map(mapPayloadArticleToIArticle)

  if (nonOpinionArticles.length === 0 && opinionArticles.length === 0) {
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

  const headlineArticle = nonOpinionArticles.find((a: IArticle) => a.isHeadline) ?? nonOpinionArticles[0]
  const headlineId = headlineArticle?.id

  // Only non-opinion articles go into the regular columns (excluding the headline)
  const otherArticles = nonOpinionArticles.filter((a: IArticle) => a.id !== headlineId)

  /******************* HEIGHT-BASED DISTRIBUTION ***********************/
  // Scientific height calculation based on actual rendered measurements
  // Column widths: left=255px, center=~380px (varies), right=296px
  // Image aspect ratio: 16:10
  
  // Helper: count words in text
  const countWords = (text: string): number => {
    return text.trim().split(/\s+/).filter((w) => w.length > 0).length
  }

  // Helper: calculate image height based on column width (aspect 16:10)
  const getImageHeight = (column: 'left' | 'center' | 'right'): number => {
    const widths = { left: 255, center: 380, right: 296 }
    return Math.round((widths[column] * 10) / 16)
  }

  // Helper: estimate height of an article in a given column based on actual measurements
  const estimateHeight = (article: IArticle, column: 'left' | 'center' | 'right', showImage: boolean): number => {
    const hasImage = article.featuredImageUrl && showImage
    
    // Count words
    const titleWords = countWords(article.headline)
    const excerptWords = countWords(article.excerpt || '')
    
    // Base spacing (padding, margins, borders)
    const spacing = hasImage 
      ? (column === 'right' ? 57 : 69)  // Right: 57px, Left/Center: 69px
      : (column === 'right' ? 37 : 49)  // Right: 37px, Left/Center: 49px
    
    // Meta height (reading time)
    const metaHeight = column === 'right' ? 16 : 20
    
    if (column === 'left') {
      // Left column: 255px wide
      const imageHeight = hasImage ? getImageHeight('left') : 0  // 159px
      const titleHeight = Math.max(90, titleWords * 10)  // ~10px per word, min 90px
      const excerptHeight = excerptWords * 4.6  // ~4.6px per word
      return Math.round(imageHeight + titleHeight + excerptHeight + metaHeight + spacing)
    } else if (column === 'center') {
      // Center column: ~380px wide (varies)
      const imageHeight = hasImage ? getImageHeight('center') : 0  // ~238px average
      const titleHeight = Math.max(55, titleWords * 6)  // ~6px per word, min 55px
      const excerptHeight = excerptWords * 3  // ~3px per word
      return Math.round(imageHeight + titleHeight + excerptHeight + metaHeight + spacing)
    } else {
      // Right column: 296px wide, no excerpts
      const imageHeight = hasImage ? getImageHeight('right') : 0  // 185px
      const titleHeight = Math.max(22, titleWords * 4)  // ~4px per word, min 22px
      return Math.round(imageHeight + titleHeight + metaHeight + spacing)
    }
  }
  
  // Special element heights (from measurements)
  const HEIGHTS = {
    headline: 520, // Large headline article with image
    opinionSection: 280, // Opinion section header + 2 articles
    spanningArticle: 220, // Spanning article height
  }

  // Calculate fixed heights at top of left+center area (before spanning)
  // Left-top will have 5 articles before the spanning article
  // Center-top will have: headline + opinion section + some articles
  const LEFT_TOP_COUNT = 5 // Fixed: articles before spanning
  const centerTopFixedHeight = HEIGHTS.headline + HEIGHTS.opinionSection

  // First pass: determine how many articles have images (for height calculation)
  // We'll use a deterministic hash to decide image visibility
  const hasImageInColumn = (article: IArticle, column: 'left' | 'center' | 'right', index: number): boolean => {
    if (!article.featuredImageUrl) return false
    if (column === 'center') return true // Center always shows images
    // Left/Right: use hash-based probability (80% for left, first 3 + 60% for right)
    const hash = String(article.id).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    if (column === 'left') return (hash % 5) < 4 // 80%
    if (column === 'right') return index < 3 || (hash % 5) < 3 // First 3 always, then 60%
    return true
  }

  // Calculate total height we want each column section to fill
  // We'll distribute articles to balance heights across columns
  
  // Step 1: Calculate how many articles go to each column based on height targets
  // Target: all columns end at approximately the same total height
  
  // HEIGHT-BASED DISTRIBUTION
  // Calculate actual heights for each article and distribute to balance column heights
  const leftColumnArticles: IArticle[] = []
  const centerColumnArticles: IArticle[] = []
  const rightColumnArticles: IArticle[] = []
  
  // Track running heights for each column
  let leftHeight = 0
  let centerHeight = centerTopFixedHeight  // Start with headline + opinion section
  let rightHeight = 0
  
  // Distribute articles to balance heights
  // Use estimated image visibility for initial distribution
  for (const article of otherArticles) {
    // Estimate which column would show image (for height calculation)
    const leftShowImg = hasImageInColumn(article, 'left', leftColumnArticles.length)
    const centerShowImg = hasImageInColumn(article, 'center', centerColumnArticles.length)
    const rightShowImg = hasImageInColumn(article, 'right', rightColumnArticles.length)
    
    const leftH = estimateHeight(article, 'left', leftShowImg)
    const centerH = estimateHeight(article, 'center', centerShowImg)
    const rightH = estimateHeight(article, 'right', rightShowImg)
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:distribution',message:'Article distribution decision',data:{articleId:String(article.id),leftHeight,centerHeight,rightHeight,leftH,centerH,rightH,leftShowImg,centerShowImg,rightShowImg},timestamp:debugTimestamp,sessionId:'debug-session',hypothesisId:'H2,H3'})}).catch(()=>{});
    // #endregion
    
    // Choose column with smallest current height
    if (leftHeight <= centerHeight && leftHeight <= rightHeight) {
      leftColumnArticles.push(article)
      leftHeight += leftH
    } else if (centerHeight <= rightHeight) {
      centerColumnArticles.push(article)
      centerHeight += centerH
    } else {
      rightColumnArticles.push(article)
      rightHeight += rightH
    }
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:distribution',message:'Distribution complete - estimated heights',data:{leftHeight,centerHeight,rightHeight,leftCount:leftColumnArticles.length,centerCount:centerColumnArticles.length,rightCount:rightColumnArticles.length,heightDifference:Math.max(leftHeight,centerHeight,rightHeight)-Math.min(leftHeight,centerHeight,rightHeight)},timestamp:debugTimestamp,sessionId:'debug-session',hypothesisId:'H2,H3'})}).catch(()=>{});
  // #endregion

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

  // Headline and opinion articles always show images if available
  if (headlineArticle?.featuredImageUrl) {
    articlesWithImages.add(normalizeId(headlineArticle.id))
  }
  opinionArticles.forEach((article) => {
    if (article.featuredImageUrl) {
      articlesWithImages.add(normalizeId(article.id))
    }
  })

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
  
  // #region agent log
  // Recalculate actual heights after image visibility decisions
  let actualLeftHeight = 0
  let actualCenterHeight = centerTopFixedHeight
  let actualRightHeight = 0
  
  leftColumnArticles.forEach((article) => {
    const showImg = articlesWithImages.has(normalizeId(article.id))
    actualLeftHeight += estimateHeight(article, 'left', showImg)
  })
  
  centerColumnArticles.forEach((article) => {
    const showImg = articlesWithImages.has(normalizeId(article.id))
    actualCenterHeight += estimateHeight(article, 'center', showImg)
  })
  
  rightColumnArticles.forEach((article) => {
    const showImg = articlesWithImages.has(normalizeId(article.id))
    actualRightHeight += estimateHeight(article, 'right', showImg)
  })
  
  fetch('http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:distribution',message:'Actual heights after image visibility decisions',data:{estimatedLeftHeight:leftHeight,estimatedCenterHeight:centerHeight,estimatedRightHeight:rightHeight,actualLeftHeight,actualCenterHeight,actualRightHeight,leftDiff:actualLeftHeight-leftHeight,centerDiff:actualCenterHeight-centerHeight,rightDiff:actualRightHeight-rightHeight,actualHeightDifference:Math.max(actualLeftHeight,actualCenterHeight,actualRightHeight)-Math.min(actualLeftHeight,actualCenterHeight,actualRightHeight)},timestamp:debugTimestamp,sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion

  // Spanning article: use the 6th left-column story (desktop only) to break monotony.
  // On mobile, we keep the classic single-column stacking (no spanning).
  const leftColumnSpanningIndex = LEFT_TOP_COUNT
  const leftColumnTopArticles = leftColumnArticles.slice(0, leftColumnSpanningIndex)
  const leftColumnSpanningArticle = leftColumnArticles[leftColumnSpanningIndex]
  const leftColumnBottomArticles = leftColumnArticles.slice(leftColumnSpanningIndex + 1)

  // HEIGHT-BASED SPANNING SPLIT:
  // Calculate how many center articles should appear before spanning to match left-top height
  // Left-top has 5 articles, we need center-before to have similar total height
  
  // Calculate left-top height using ACTUAL image visibility (not estimated)
  let leftTopHeight = 0
  let leftTopHeightEstimated = 0
  leftColumnTopArticles.forEach((article, idx) => {
    const showImgEstimated = hasImageInColumn(article, 'left', idx)
    const showImgActual = articlesWithImages.has(normalizeId(article.id))
    const heightEstimated = estimateHeight(article, 'left', showImgEstimated)
    const heightActual = estimateHeight(article, 'left', showImgActual)
    leftTopHeightEstimated += heightEstimated
    leftTopHeight += heightActual  // Use actual visibility for final calculation
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:spanning-split',message:'Left-top article height calculation',data:{articleId:String(article.id),index:idx,showImgEstimated,showImgActual,heightEstimated,heightActual},timestamp:debugTimestamp,sessionId:'debug-session',hypothesisId:'H1',runId:'pre-fix'})}).catch(()=>{});
    // #endregion
  })
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:spanning-split',message:'Left-top total height comparison',data:{leftTopHeightEstimated,leftTopHeight,difference:leftTopHeight-leftTopHeightEstimated},timestamp:debugTimestamp,sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  
  // Center-top starts with headline + opinion section
  let centerTopHeight = centerTopFixedHeight
  
  // Add center articles until we roughly match left-top height
  // Use larger tolerance and try to get as close as possible
  let centerBeforeCount = 0
  let bestMatch = Infinity
  let bestCount = 0
  
  for (let i = 0; i < centerColumnArticles.length; i++) {
    const article = centerColumnArticles[i]
    const articleHeight = estimateHeight(article, 'center', true)
    const newHeight = centerTopHeight + articleHeight
    const difference = Math.abs(newHeight - leftTopHeight)
    
    // Track the best match (closest to left-top height)
    if (difference < bestMatch) {
      bestMatch = difference
      bestCount = i + 1
    }
    
    // Continue adding if we're still within reasonable range (200px tolerance)
    if (newHeight <= leftTopHeight + 200) {
      centerTopHeight = newHeight
      centerBeforeCount = i + 1
    } else {
      // We've gone too far - use the best match we found (if it's better than current)
      const currentDiff = Math.abs(centerTopHeight - leftTopHeight)
      if (bestCount > 0 && bestMatch < currentDiff) {
        centerBeforeCount = bestCount
        // Recalculate centerTopHeight for the best match
        centerTopHeight = centerTopFixedHeight
        for (let j = 0; j < bestCount; j++) {
          centerTopHeight += estimateHeight(centerColumnArticles[j], 'center', true)
        }
      }
      break
    }
  }
  // Ensure at least 2 center articles before spanning
  centerBeforeCount = Math.max(2, centerBeforeCount)
  
  // #region agent log
  const centerAfterCount = centerColumnArticles.length - centerBeforeCount
  const leftBottomCount = leftColumnBottomArticles.length
  
  // Calculate actual heights for bottom sections
  let leftBottomHeight = 0
  leftColumnBottomArticles.forEach((article) => {
    const showImg = articlesWithImages.has(normalizeId(article.id))
    leftBottomHeight += estimateHeight(article, 'left', showImg)
  })
  
  let centerAfterHeight = 0
  const centerAfterArticles = centerColumnArticles.slice(centerBeforeCount)
  centerAfterArticles.forEach((article) => {
    const showImg = articlesWithImages.has(normalizeId(article.id))
    centerAfterHeight += estimateHeight(article, 'center', showImg)
  })
  
  fetch('http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:spanning-split',message:'Spanning split results',data:{leftTopHeight,centerTopHeight,centerBeforeCount,centerAfterCount,leftBottomCount,leftBottomHeight,centerAfterHeight,topHeightDifference:Math.abs(leftTopHeight-centerTopHeight),bottomHeightDifference:Math.abs(leftBottomHeight-centerAfterHeight),bestMatch},timestamp:debugTimestamp,sessionId:'debug-session',hypothesisId:'H1,H4',runId:'post-fix-v2'})}).catch(()=>{});
  // #endregion
  
  const centerColumnBeforeSpanning = centerColumnArticles.slice(0, centerBeforeCount)
  const centerColumnAfterSpanning = centerColumnArticles.slice(centerBeforeCount)

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
                    index={index}
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
                        index={index}
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
                    index={leftColumnTopArticles.length + 1 + index}
                  />
                ))}
              </div>

              {/* Center column (bottom) */}
              <div className="lg:px-6">
                {centerColumnAfterSpanning.length > 0 && (
                  <div className={leftColumnSpanningArticle ? 'mt-8' : 'mt-8 pt-8 border-t-2 border-[rgba(18,18,18,0.7)]'}>
                    {centerColumnAfterSpanning.map((article: IArticle, index: number) => (
                      <CenterColumnArticle
                        key={article.id}
                        article={article}
                        isLast={index === centerColumnAfterSpanning.length - 1}
                        showImage={articlesWithImages.has(String(article.id))}
                        index={centerColumnBeforeSpanning.length + index}
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
                index={index}
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
  index,
}: {
  article: IArticle
  isLast: boolean
  showImage: boolean
  index?: number
}) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link key={article.id} href={`/article/${article.slug}`} className="group block">
      <article className={`pb-5 mb-5 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        <ArticleHeightMeasurer article={article} column="left" showImage={showImage} index={index ?? 0} />
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

function OpinionSection({ articles }: { articles: IArticle[] }) {
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

function CenterColumnArticle({
  article,
  isLast,
  showImage,
  index,
}: {
  article: IArticle
  isLast: boolean
  showImage: boolean
  index?: number
}) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link href={`/article/${article.slug}`} className="group block">
      <article className={`pb-5 mb-5 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        <ArticleHeightMeasurer article={article} column="center" showImage={showImage} index={index ?? 0} />
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

function SpanningArticle({
  article,
  showImage,
}: {
  article: IArticle
  showImage: boolean
}) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link href={`/article/${article.slug}`} className="group block">
      <article className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 items-start">
        {showImage && article.featuredImageUrl && (
          <div className="relative w-full aspect-[16/10] overflow-hidden self-start">
            <Image
              src={article.featuredImageUrl}
              alt={article.headline}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 280px"
            />
          </div>
        )}
        <div className={`${showImage && article.featuredImageUrl ? '' : 'md:col-span-2'} self-start`}>
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

function RightColumnArticle({
  article,
  isLast,
  showImage,
  index,
}: {
  article: IArticle
  isLast: boolean
  showImage: boolean
  index?: number
}) {
  const readingTime = calculateReadingTime(article.content)
  return (
    <Link key={article.id} href={`/article/${article.slug}`} className="group block">
      <article className={`pb-4 mb-4 ${!isLast ? 'border-b border-[#e2e2e2]' : ''}`}>
        <ArticleHeightMeasurer article={article} column="right" showImage={showImage} index={index ?? 0} />
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
