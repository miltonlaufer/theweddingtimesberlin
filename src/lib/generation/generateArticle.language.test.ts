import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateArticle } from './generateArticle'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(() => ({
    invoke: mocks.invoke,
  })),
}))

const originalEnv = process.env
const coherentBody = [
  'Patients arrived at the hospital queue before sunrise because the new waiting policy rewards visible patience.',
  "Administrators closed another service desk and told the crowd that delay was now the institution's main form of care.",
  'By noon, the patients had organized the queue into shifts while officials praised the hospital for reducing expectations.',
].join('\n\n')

const bodyOnlyArticle = {
  bodyMarkdown: coherentBody,
  categorySlug: 'bureaucracy',
  authorSlug: 'staff-writer',
  newAuthorName: null,
  newAuthorTitle: null,
  newAuthorBio: null,
  layout: 'standard' as const,
  isFeatured: false,
  isHeadline: false,
  imageCaption: 'Patients wait beside a closed hospital service desk.',
  imagePrompt: 'A documentary photograph of patients waiting at a closed hospital desk.',
  canonicalSourceAuthor: null,
  canonicalSourceStory: null,
}

const fullArticle = {
  headline: 'Hospital Queue Turns Patience Into Policy',
  subheadline: 'The hospital turns waiting into public policy.',
  excerpt: 'Patients discover that patience is now an administrative requirement.',
  sourceRssTopic: null,
  ...bodyOnlyArticle,
}

function makeInput() {
  return {
    categories: [{ slug: 'bureaucracy', name: 'Bureaucracy' }],
    authors: [{ slug: 'staff-writer', name: 'Staff Writer' }],
    topicSummary: '',
    includeTopics: false,
    recentArticleTitles: [],
    recentArticleExcerpts: [],
    precomputedBlacklistSummary: '',
    useHumorPerspectiveMethod: false,
    manualOverrides: {
      useRandomModes: false,
      includeBerlinThemes: false,
    },
  }
}

describe('generateArticle final article-language guard', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: 'test-key',
      SATIRE_BRIEF_ENABLED: 'false',
      SATIRE_CRITIQUE_ENABLED: 'false',
    }
    mocks.invoke.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it.each([
    {
      language: 'German',
      field: 'excerpt',
      article: {
        ...fullArticle,
        excerpt: 'Patients say bitte while the hospital closes another desk.',
      },
    },
    {
      language: 'French',
      field: 'excerpt',
      article: {
        ...fullArticle,
        excerpt: 'Les patients attendent pendant que le guichet ferme.',
      },
      semanticResponse: {
        languagePass: false,
        englishShare: 1,
        invalidField: 'excerpt',
        germanUsageSummary: 'The excerpt is French rather than US English.',
        reason: 'Supporting text language policy failed.',
      },
    },
    {
      language: 'Spanish',
      field: 'subheadline',
      article: {
        ...fullArticle,
        subheadline: 'Los pacientes esperan mientras la oficina cierra.',
      },
      semanticResponse: {
        languagePass: false,
        englishShare: 1,
        invalidField: 'subheadline',
        germanUsageSummary: 'The subheadline is Spanish rather than US English.',
        reason: 'Supporting text language policy failed.',
      },
    },
    {
      language: 'Italian',
      field: 'subheadline',
      article: {
        ...fullArticle,
        subheadline: 'I pazienti aspettano mentre lo sportello chiude.',
      },
      semanticResponse: {
        languagePass: false,
        englishShare: 1,
        invalidField: 'subheadline',
        germanUsageSummary: 'The subheadline is Italian rather than US English.',
        reason: 'Supporting text language policy failed.',
      },
    },
  ])(
    'rejects a $language $field on the direct no-seed result path',
    async ({ article, field, semanticResponse }) => {
      mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(article) })
      if (semanticResponse) {
        mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(semanticResponse) })
      }

      await expect(generateArticle(makeInput())).rejects.toThrow(
        `HEADLINE_LANGUAGE_GUARD: ${field}`,
      )
    },
  )

  it('keeps a deterministically clean article when the final language evaluator is unavailable', async () => {
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(fullArticle) })
    mocks.invoke.mockRejectedValueOnce(new Error('language evaluator unavailable'))

    const result = await generateArticle(makeInput())

    expect(result.article.headline).toBe(fullArticle.headline)
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      path: 'normal',
      responses: [{ content: JSON.stringify(bodyOnlyArticle) }],
    },
    {
      path: 'repaired',
      responses: [{ content: 'not JSON' }, { content: JSON.stringify(bodyOnlyArticle) }],
    },
  ])('rejects a restored invalid headline on the $path result path', async ({ responses }) => {
    mocks.invoke.mockResolvedValueOnce(responses[0]!)
    if (responses[1]) mocks.invoke.mockResolvedValueOnce(responses[1])

    await expect(
      generateArticle({
        ...makeInput(),
        seedDraft: {
          headline: 'DU ARSCHLOCH, JETZT BITTE MIT APPLAUS',
          subheadline: 'The hospital turns waiting into public policy.',
          excerpt: 'Patients discover that patience is now an administrative requirement.',
        },
      }),
    ).rejects.toThrow('HEADLINE_LANGUAGE_GUARD: headline')
  })

  it.each([
    {
      path: 'normal',
      responses: [{ content: JSON.stringify(bodyOnlyArticle) }],
    },
    {
      path: 'repaired',
      responses: [{ content: 'not JSON' }, { content: JSON.stringify(bodyOnlyArticle) }],
    },
  ])(
    'rejects restored non-English supporting text on the $path result path',
    async ({ responses }) => {
      mocks.invoke.mockResolvedValueOnce(responses[0]!)
      if (responses[1]) mocks.invoke.mockResolvedValueOnce(responses[1])

      await expect(
        generateArticle({
          ...makeInput(),
          seedDraft: {
            headline: 'Hospital Queue Turns Patience Into Policy',
            subheadline: 'The hospital turns waiting into public policy.',
            excerpt: 'Patients say bitte while the hospital closes another desk.',
          },
        }),
      ).rejects.toThrow('HEADLINE_LANGUAGE_GUARD: excerpt')
    },
  )
})
