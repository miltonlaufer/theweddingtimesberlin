export interface ICategory {
  id: string
  name: string
  slug: string
  description?: string
  order: number
}

export interface IAuthor {
  id: string
  name: string
  slug: string
  title?: string
  bio?: string
  photoUrl?: string
  email?: string
}

export interface IArticle {
  id: string
  headline: string
  subheadline?: string
  slug: string
  featuredImageUrl?: string
  imageCaption?: string
  content: string
  excerpt?: string
  category: ICategory
  author: IAuthor
  publishedAt?: string
  status: 'draft' | 'published'
  isFeatured: boolean
  isHeadline: boolean
  layout: 'standard' | 'wide' | 'opinion'
}

export interface IArticlesFilter {
  categorySlug?: string
  authorSlug?: string
  status?: 'draft' | 'published'
  isFeatured?: boolean
  isHeadline?: boolean
}
