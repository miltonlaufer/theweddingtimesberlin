import type { CollectionConfig } from 'payload'

export const GenerationJobs: CollectionConfig = {
  slug: 'generation-jobs',
  admin: {
    useAsTitle: 'jobKey',
    defaultColumns: [
      'jobKey',
      'status',
      'requestedCount',
      'acceptedCount',
      'createdCount',
      'failedCount',
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
      name: 'jobKey',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'drafting',
      index: true,
      options: [
        { label: 'Drafting', value: 'drafting' },
        { label: 'Evaluating', value: 'evaluating' },
        { label: 'Generating', value: 'generating' },
        { label: 'Finalizing', value: 'finalizing' },
        { label: 'Completed', value: 'completed' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    {
      name: 'requestedCount',
      type: 'number',
      required: true,
      min: 1,
    },
    {
      name: 'acceptedCount',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'createdCount',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'failedCount',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'draftRetriesUsed',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'startedAt',
      type: 'date',
      index: true,
    },
    {
      name: 'completedAt',
      type: 'date',
      index: true,
    },
    {
      name: 'metadata',
      type: 'json',
      admin: {
        description: 'Context and summary info for this run.',
      },
    },
    {
      name: 'errorSummary',
      type: 'textarea',
      admin: {
        description: 'Trimmed error summary for failed runs.',
      },
    },
  ],
}
