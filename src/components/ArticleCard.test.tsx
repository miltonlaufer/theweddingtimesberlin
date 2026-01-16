import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArticleCard } from './ArticleCard'
import type { IArticle } from '@/types/article'

const article: IArticle = {
  id: '1',
  headline: 'Test Headline',
  subheadline: 'Subheadline',
  slug: 'test-headline',
  featuredImageUrl: 'https://example.com/image.jpg',
  imageCaption: 'Caption',
  content: '<p>Some content</p>',
  excerpt: 'Short excerpt',
  category: {
    id: 'cat-1',
    name: 'Category',
    slug: 'category',
    order: 1,
  },
  author: {
    id: 'auth-1',
    name: 'Alex Author',
    slug: 'alex-author',
  },
  publishedAt: '2024-01-01T00:00:00.000Z',
  status: 'published',
  isFeatured: false,
  isHeadline: false,
  layout: 'standard',
}

describe('ArticleCard', () => {
  it('renders headline and category link', () => {
    const { getByRole, getByText } = render(<ArticleCard article={article} showImage={false} />)

    expect(getByRole('heading', { name: 'Test Headline' })).toBeInTheDocument()
    const categoryLink = getByText('Category').closest('a')
    expect(categoryLink).toHaveAttribute('href', '/section/category')
  })

  it('renders byline when enabled', () => {
    const { getByText } = render(
      <ArticleCard article={article} showImage={false} showExcerpt={false} />,
    )
    expect(getByText(/By Alex Author/i)).toBeInTheDocument()
  })
})
