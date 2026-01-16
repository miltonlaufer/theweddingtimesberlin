'use client'

import { useEffect } from 'react'
import type { IArticle } from '@/types/article'

interface ArticleHeightMeasurerProps {
  article: IArticle
  column: 'left' | 'center' | 'right'
  showImage: boolean
  index: number
}

export function ArticleHeightMeasurer({
  article,
  column,
  showImage,
  index,
}: ArticleHeightMeasurerProps) {
  useEffect(() => {
    // Find parent article element (this component is a child of <article>)
    const measurerEl = document.querySelector(`[data-measurer-id="${article.id}"]`)
    if (!measurerEl) return

    const articleEl = measurerEl.closest('article') as HTMLElement
    if (!articleEl) return

    // Wait for images to load
    const measure = () => {
      const rect = articleEl.getBoundingClientRect()
      const totalHeight = rect.height

      // Find image element
      const imageEl = articleEl.querySelector('div[class*="aspect"]') as HTMLElement
      const imageHeight = imageEl ? imageEl.getBoundingClientRect().height : 0

      // Find title element
      const titleEl = articleEl.querySelector('h2, h3') as HTMLElement
      const titleHeight = titleEl ? titleEl.getBoundingClientRect().height : 0
      const titleText = titleEl?.textContent || ''
      const titleWords = titleText.trim().split(/\s+/).filter((w) => w.length > 0).length

      // Find excerpt element
      const excerptEl = articleEl.querySelector('p[class*="font-serif"]') as HTMLElement
      const excerptHeight = excerptEl ? excerptEl.getBoundingClientRect().height : 0
      const excerptText = excerptEl?.textContent || ''
      const excerptWords = excerptText.trim().split(/\s+/).filter((w) => w.length > 0).length

      // Find meta element (reading time)
      const metaEl = articleEl.querySelector('p[class*="uppercase"]') as HTMLElement
      const metaHeight = metaEl ? metaEl.getBoundingClientRect().height : 0

      // Calculate padding/margins (total - content)
      const contentHeight = imageHeight + titleHeight + excerptHeight + metaHeight
      const spacing = totalHeight - contentHeight

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: 'ArticleHeightMeasurer:measure',
          message: 'Measured article height and word counts',
          data: {
            articleId: String(article.id),
            column,
            index,
            showImage,
            totalHeight: Math.round(totalHeight),
            imageHeight: Math.round(imageHeight),
            titleHeight: Math.round(titleHeight),
            titleWords,
            excerptHeight: Math.round(excerptHeight),
            excerptWords,
            metaHeight: Math.round(metaHeight),
            spacing: Math.round(spacing),
            // Column width for image calculation
            columnWidth: rect.width,
          },
          timestamp: Date.now(),
          sessionId: 'debug-session',
          hypothesisId: 'H-measure',
        }),
      }).catch(() => {})
      // #endregion
    }

    // Measure after a short delay to ensure layout is complete
    const timeoutId = setTimeout(measure, 100)
    
    // Also measure when images load
    const images = articleEl.querySelectorAll('img')
    let loadedCount = 0
    const checkImages = () => {
      loadedCount++
      if (loadedCount >= images.length) {
        setTimeout(measure, 50)
      }
    }
    images.forEach((img) => {
      if (img.complete) {
        checkImages()
      } else {
        img.addEventListener('load', checkImages, { once: true })
      }
    })

    return () => {
      clearTimeout(timeoutId)
      images.forEach((img) => {
        img.removeEventListener('load', checkImages)
      })
    }
  }, [article, column, showImage, index])

  return <span data-measurer-id={article.id} style={{ display: 'none' }} />
}
