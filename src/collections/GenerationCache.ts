import type { CollectionConfig } from 'payload'

export const GenerationCache: CollectionConfig = {
  slug: 'generation-cache',
  admin: {
    useAsTitle: 'cacheKey',
    defaultColumns: ['cacheType', 'cacheKey', 'articleCount', 'expiresAt', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: [
    {
      name: 'cacheType',
      type: 'select',
      required: true,
      defaultValue: 'blacklist-summary',
      options: [{ label: 'Blacklist Summary', value: 'blacklist-summary' }],
      index: true,
    },
    {
      name: 'cacheKey',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'signature',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Hash of recent titles/excerpts used as cache input fingerprint',
      },
    },
    {
      name: 'summary',
      type: 'textarea',
      required: true,
    },
    {
      name: 'articleCount',
      type: 'number',
      required: true,
      min: 0,
    },
    {
      name: 'expiresAt',
      type: 'date',
      index: true,
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
  ],
}
