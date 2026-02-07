import type { CollectionConfig } from 'payload'
import { getBaseUrl } from '@/lib/getBaseUrl'
import { postToInstagram } from '@/lib/instagram/postToInstagram'

type ArticleDoc = {
  headline?: string
  slug?: string
  excerpt?: string
  featuredImageUrl?: string | null
  status?: string
}

function shouldPostToInstagram(
  doc: ArticleDoc,
  previousDoc: ArticleDoc | null,
  operation: 'create' | 'update' | 'delete',
): boolean {
  if (operation === 'delete') return false
  if (doc.status !== 'published') return false
  const hadImage = Boolean(doc.featuredImageUrl?.trim())
  const hadHeadline = Boolean(doc.headline?.trim())
  if (!hadImage || !hadHeadline) return false
  if (operation === 'create') return true
  return previousDoc?.status !== 'published'
}

export const Articles: CollectionConfig = {
  slug: 'articles',
  admin: {
    useAsTitle: 'headline',
    defaultColumns: ['headline', 'category', 'author', 'publishedAt', 'status'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'headline',
      type: 'text',
      required: true,
      index: true, // For search queries
    },
    {
      name: 'subheadline',
      type: 'text',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true, // Already indexed by unique, but explicit for clarity
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'featuredImage',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'featuredImageUrl',
      type: 'text',
      admin: {
        description: 'External image URL (e.g. Supabase Storage). Used when running on Vercel.',
      },
    },
    {
      name: 'imageCaption',
      type: 'text',
    },
    {
      name: 'content',
      type: 'richText',
      required: true,
    },
    {
      name: 'excerpt',
      type: 'textarea',
      maxLength: 300,
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
      index: true, // For filtering by category
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'authors',
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      index: true, // For sorting by date
      admin: {
        position: 'sidebar',
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      index: true, // For filtering published articles
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'isFeatured',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Feature this article prominently on the homepage',
      },
    },
    {
      name: 'isHeadline',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Make this the main headline story',
      },
    },
    {
      name: 'layout',
      type: 'select',
      defaultValue: 'standard',
      options: [
        { label: 'Standard', value: 'standard' },
        { label: 'Wide Image', value: 'wide' },
        { label: 'Opinion', value: 'opinion' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'sourceRssTopic',
      type: 'text',
      admin: {
        position: 'sidebar',
        description: 'The RSS news topic that inspired this article (if any)',
      },
    },
  ],
  hooks: {
    afterChange: [
      ({ doc, previousDoc, operation }) => {
        const d = doc as ArticleDoc
        const prev = (previousDoc ?? null) as ArticleDoc | null
        if (!shouldPostToInstagram(d, prev, operation as 'create' | 'update' | 'delete')) return

        const imageUrl = d.featuredImageUrl?.trim()
        const slug = d.slug?.trim()
        const headline = d.headline?.trim()
        const excerpt = d.excerpt?.trim()
        if (!imageUrl || !slug || !headline) return

        const articleUrl = `${getBaseUrl()}/article/${slug}`
        const caption = excerpt
          ? `${headline}\n\n${excerpt}\n\n${articleUrl}`
          : `${headline}\n\n${articleUrl}`

        postToInstagram({
          imageUrl,
          caption,
          altText: headline,
        }).then((result) => {
          if (!result.ok) {
            console.warn('[Instagram] Post failed:', result.error)
          }
        })
      },
    ],
  },
}
