import type { IArticle } from '@/types/article'
import type { SerializedEditorState } from 'lexical'
import { convertLexicalToHTML, defaultHTMLConverters } from '@payloadcms/richtext-lexical/html'
import { toWebpUrl } from '@/lib/storage'

/******************* TYPES ***********************/

type PayloadRelation =
  | string
  | {
      id?: string
      slug?: string
      name?: string
      title?: string
      bio?: string
      description?: string
      order?: number
      url?: string
    }

export interface PayloadArticleLike {
  id: string
  headline: string
  subheadline?: string | null
  slug: string
  featuredImageUrl?: string | null
  excerpt?: string | null
  content?: unknown
  category?: PayloadRelation
  author?: PayloadRelation
  featuredImage?: PayloadRelation
  imageCaption?: string | null
  publishedAt?: string | null
  status?: 'draft' | 'published'
  isFeatured?: boolean
  isHeadline?: boolean
  layout?: 'standard' | 'wide' | 'opinion'
}

/******************* HELPERS ***********************/

function asObj(relation: PayloadRelation | undefined): Record<string, unknown> | null {
  if (relation && typeof relation === 'object') return relation as Record<string, unknown>
  return null
}

function getString(obj: Record<string, unknown> | null, key: string): string | undefined {
  const v = obj?.[key]
  return typeof v === 'string' ? v : undefined
}

function getNumber(obj: Record<string, unknown> | null, key: string): number | undefined {
  const v = obj?.[key]
  return typeof v === 'number' ? v : undefined
}

function toHtmlString(value: unknown): string {
  if (typeof value === 'string') return value

  // Lexical JSON → HTML
  if (value && typeof value === 'object' && 'root' in value) {
    try {
      return convertLexicalToHTML({
        data: value as SerializedEditorState,
        converters: defaultHTMLConverters,
      })
    } catch {
      // Conversion failed - return empty string so UI doesn't crash
      return ''
    }
  }

  return ''
}

/******************* MAIN ***********************/

export function mapPayloadArticleToIArticle(doc: PayloadArticleLike): IArticle {
  const categoryObj = asObj(doc.category)
  const authorObj = asObj(doc.author)
  const imageObj = asObj(doc.featuredImage)

  const categorySlug = getString(categoryObj, 'slug') ?? 'unknown'
  const categoryName = getString(categoryObj, 'name') ?? 'Unknown'

  const authorSlug = getString(authorObj, 'slug') ?? 'unknown'
  const authorName = getString(authorObj, 'name') ?? 'Unknown'

  // Convert PNG URLs to WebP for better performance (both formats are uploaded)
  const rawImageUrl = doc.featuredImageUrl ?? getString(imageObj, 'url')
  const featuredImageUrl = toWebpUrl(rawImageUrl)

  return {
    id: doc.id,
    headline: doc.headline,
    subheadline: doc.subheadline ?? undefined,
    slug: doc.slug,
    featuredImageUrl,
    imageCaption: doc.imageCaption ?? undefined,
    content: toHtmlString(doc.content),
    excerpt: doc.excerpt ?? undefined,
    category: {
      id: getString(categoryObj, 'id') ?? categorySlug,
      name: categoryName,
      slug: categorySlug,
      description: getString(categoryObj, 'description'),
      order: getNumber(categoryObj, 'order') ?? 0,
    },
    author: {
      id: getString(authorObj, 'id') ?? authorSlug,
      name: authorName,
      slug: authorSlug,
      title: getString(authorObj, 'title'),
      bio: getString(authorObj, 'bio'),
    },
    publishedAt: doc.publishedAt ?? undefined,
    status: doc.status ?? 'draft',
    isFeatured: doc.isFeatured ?? false,
    isHeadline: doc.isHeadline ?? false,
    layout: doc.layout ?? 'standard',
  }
}
