import type { CollectionConfig } from 'payload'

export const GenerationJobItems: CollectionConfig = {
  slug: 'generation-job-items',
  admin: {
    useAsTitle: 'headline',
    defaultColumns: [
      'job',
      'slotIndex',
      'status',
      'draftAttempt',
      'headline',
      'articleSlug',
      'updatedAt',
    ],
  },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: [
    {
      name: 'job',
      type: 'relationship',
      relationTo: 'generation-jobs',
      required: true,
      index: true,
    },
    {
      name: 'slotIndex',
      type: 'number',
      required: true,
      index: true,
      min: 0,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft-pending',
      index: true,
      options: [
        { label: 'Draft Pending', value: 'draft-pending' },
        { label: 'Draft Rejected', value: 'draft-rejected' },
        { label: 'Draft Accepted', value: 'draft-accepted' },
        { label: 'Processing', value: 'processing' },
        { label: 'Completed', value: 'completed' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    {
      name: 'draftAttempt',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'slotConfig',
      type: 'json',
      admin: {
        description: 'Force flags and topic mode for this slot.',
      },
    },
    {
      name: 'headline',
      type: 'text',
      index: true,
    },
    {
      name: 'subheadline',
      type: 'text',
    },
    {
      name: 'excerpt',
      type: 'textarea',
      maxLength: 300,
    },
    {
      name: 'draftEvaluation',
      type: 'json',
      admin: {
        description: 'Repetition/tone evaluation details for the draft.',
      },
    },
    {
      name: 'sourceRssTopic',
      type: 'text',
      admin: {
        description: 'RSS topic tied to this slot/draft if any.',
      },
    },
    {
      name: 'article',
      type: 'relationship',
      relationTo: 'articles',
      admin: {
        description: 'Linked article when generation succeeds.',
      },
    },
    {
      name: 'articleSlug',
      type: 'text',
      index: true,
    },
    {
      name: 'categorySlug',
      type: 'text',
    },
    {
      name: 'error',
      type: 'textarea',
    },
    {
      name: 'startedAt',
      type: 'date',
    },
    {
      name: 'completedAt',
      type: 'date',
    },
  ],
}
