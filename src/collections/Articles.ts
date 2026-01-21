import type { CollectionConfig } from 'payload'

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
}
