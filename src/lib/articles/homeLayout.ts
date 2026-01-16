import type { IArticle } from '@/types/article'

type Column = 'left' | 'center' | 'right'

const COLUMN_WIDTHS: Record<Column, number> = {
  left: 255,
  center: 380,
  right: 296,
}

const HEIGHTS = {
  headline: 520,
  opinionSection: 280,
}

const LEFT_TOP_COUNT = 5

const normalizeId = (id: string | number): string => String(id)

const countWords = (text: string): number =>
  text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length

const getImageHeight = (column: Column): number => {
  return Math.round((COLUMN_WIDTHS[column] * 10) / 16)
}

const estimateHeight = (article: IArticle, column: Column, showImage: boolean): number => {
  const hasImage = Boolean(article.featuredImageUrl && showImage)
  const titleWords = countWords(article.headline)
  const excerptWords = countWords(article.excerpt || '')

  const spacing = hasImage ? (column === 'right' ? 57 : 69) : column === 'right' ? 37 : 49

  const metaHeight = column === 'right' ? 16 : 20

  if (column === 'left') {
    const imageHeight = hasImage ? getImageHeight('left') : 0
    const titleHeight = Math.max(90, titleWords * 10)
    const excerptHeight = excerptWords * 4.6
    return Math.round(imageHeight + titleHeight + excerptHeight + metaHeight + spacing)
  }

  if (column === 'center') {
    const imageHeight = hasImage ? getImageHeight('center') : 0
    const titleHeight = Math.max(55, titleWords * 6)
    const excerptHeight = excerptWords * 3
    return Math.round(imageHeight + titleHeight + excerptHeight + metaHeight + spacing)
  }

  const imageHeight = hasImage ? getImageHeight('right') : 0
  const titleHeight = Math.max(22, titleWords * 4)
  return Math.round(imageHeight + titleHeight + metaHeight + spacing)
}

const hasImageInColumn = (article: IArticle, column: Column, index: number): boolean => {
  if (!article.featuredImageUrl) return false
  if (column === 'center') return true
  const hash = normalizeId(article.id)
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0)
  if (column === 'left') return hash % 5 < 4
  if (column === 'right') return index < 3 || hash % 5 < 3
  return true
}

export interface HomeLayoutResult {
  leftColumnArticles: IArticle[]
  centerColumnArticles: IArticle[]
  rightColumnArticles: IArticle[]
  articlesWithImages: Set<string>
  leftColumnTopArticles: IArticle[]
  leftColumnSpanningArticle?: IArticle
  leftColumnBottomArticles: IArticle[]
  centerColumnBeforeSpanning: IArticle[]
  centerColumnAfterSpanning: IArticle[]
}

export function buildHomeLayout(args: {
  otherArticles: IArticle[]
  headlineArticle?: IArticle
  opinionArticles: IArticle[]
}): HomeLayoutResult {
  const { otherArticles, headlineArticle, opinionArticles } = args

  const centerTopFixedHeight =
    (headlineArticle ? HEIGHTS.headline : 0) +
    (opinionArticles.length > 0 ? HEIGHTS.opinionSection : 0)

  const leftColumnArticles: IArticle[] = []
  const centerColumnArticles: IArticle[] = []
  const rightColumnArticles: IArticle[] = []

  let leftHeight = 0
  let centerHeight = centerTopFixedHeight
  let rightHeight = 0

  for (const article of otherArticles) {
    const leftShowImg = hasImageInColumn(article, 'left', leftColumnArticles.length)
    const centerShowImg = hasImageInColumn(article, 'center', centerColumnArticles.length)
    const rightShowImg = hasImageInColumn(article, 'right', rightColumnArticles.length)

    const leftH = estimateHeight(article, 'left', leftShowImg)
    const centerH = estimateHeight(article, 'center', centerShowImg)
    const rightH = estimateHeight(article, 'right', rightShowImg)

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

  const articlesWithImages = new Set<string>()

  centerColumnArticles.forEach((article) => {
    if (article.featuredImageUrl) {
      articlesWithImages.add(normalizeId(article.id))
    }
  })

  if (headlineArticle?.featuredImageUrl) {
    articlesWithImages.add(normalizeId(headlineArticle.id))
  }

  opinionArticles.forEach((article) => {
    if (article.featuredImageUrl) {
      articlesWithImages.add(normalizeId(article.id))
    }
  })

  leftColumnArticles.forEach((article) => {
    if (article.featuredImageUrl) {
      const idStr = normalizeId(article.id)
      const hash = idStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      if (hash % 5 < 4) {
        articlesWithImages.add(idStr)
      }
    }
  })

  rightColumnArticles.forEach((article, index) => {
    if (article.featuredImageUrl) {
      if (index < 3) {
        articlesWithImages.add(normalizeId(article.id))
      } else {
        const idStr = normalizeId(article.id)
        const hash = idStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
        if (hash % 5 < 3) {
          articlesWithImages.add(idStr)
        }
      }
    }
  })

  const leftColumnSpanningIndex = LEFT_TOP_COUNT
  const leftColumnTopArticles = leftColumnArticles.slice(0, leftColumnSpanningIndex)
  const leftColumnSpanningArticle = leftColumnArticles[leftColumnSpanningIndex]
  const leftColumnBottomArticles = leftColumnArticles.slice(leftColumnSpanningIndex + 1)

  let leftTopHeight = 0
  leftColumnTopArticles.forEach((article) => {
    const showImgActual = articlesWithImages.has(normalizeId(article.id))
    leftTopHeight += estimateHeight(article, 'left', showImgActual)
  })

  let centerTopHeight = centerTopFixedHeight
  let centerBeforeCount = 0
  let bestMatch = Infinity
  let bestCount = 0

  for (let i = 0; i < centerColumnArticles.length; i++) {
    const article = centerColumnArticles[i]
    const articleHeight = estimateHeight(article, 'center', true)
    const newHeight = centerTopHeight + articleHeight
    const difference = Math.abs(newHeight - leftTopHeight)

    if (difference < bestMatch) {
      bestMatch = difference
      bestCount = i + 1
    }

    if (newHeight <= leftTopHeight + 200) {
      centerTopHeight = newHeight
      centerBeforeCount = i + 1
    } else {
      const currentDiff = Math.abs(centerTopHeight - leftTopHeight)
      if (bestCount > 0 && bestMatch < currentDiff) {
        centerBeforeCount = bestCount
        centerTopHeight = centerTopFixedHeight
        for (let j = 0; j < bestCount; j++) {
          centerTopHeight += estimateHeight(centerColumnArticles[j], 'center', true)
        }
      }
      break
    }
  }

  centerBeforeCount = Math.min(centerColumnArticles.length, Math.max(2, centerBeforeCount))

  const centerColumnBeforeSpanning = centerColumnArticles.slice(0, centerBeforeCount)
  const centerColumnAfterSpanning = centerColumnArticles.slice(centerBeforeCount)

  return {
    leftColumnArticles,
    centerColumnArticles,
    rightColumnArticles,
    articlesWithImages,
    leftColumnTopArticles,
    leftColumnSpanningArticle,
    leftColumnBottomArticles,
    centerColumnBeforeSpanning,
    centerColumnAfterSpanning,
  }
}
