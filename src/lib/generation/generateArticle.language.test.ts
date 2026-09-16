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

  it('makes sexual double meaning a structural article concept shared by the headline', async () => {
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(fullArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        reason: 'All fields pass.',
      }),
    })

    await generateArticle(makeInput())

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toMatch(/sexual double meaning.*(?:core|structural).*comedic/i)
    expect(combined).toMatch(/power dynamics.*escalation.*(?:ending|conclusion)/i)
    expect(combined).toMatch(/headline.*(?:same|central).*double meaning/i)
    expect(combined).not.toContain('Include 4-6 double entendres')
    expect(combined).toContain('NEVER BREAK THE FOURTH WALL')
    expect(combined).toMatch(/all reader-visible text/i)
  })

  it('makes critique and rewrite preserve conceptual innuendo in the headline and story', async () => {
    process.env.SATIRE_CRITIQUE_ENABLED = 'true'
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(fullArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        darknessScore: 6,
        politicalCriticismScore: 6,
        discomfortScore: 6,
        specificityScore: 6,
        passes: false,
        strongestLine: 'The hospital turns waiting into public policy.',
        weaknesses: ['The sexual double meaning is decorative rather than structural.'],
        revisionInstructions: ['Make the double meaning drive the institutional premise.'],
      }),
    })
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(fullArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        reason: 'All fields pass.',
      }),
    })

    await generateArticle(makeInput())

    const critiqueMessages = mocks.invoke.mock.calls[1]?.[0] as Array<{ content: string }>
    const critiquePrompt = critiqueMessages.map((message) => message.content).join('\n')
    const rewriteMessages = mocks.invoke.mock.calls[2]?.[0] as Array<{ content: string }>
    const rewritePrompt = rewriteMessages.map((message) => message.content).join('\n')

    expect(critiquePrompt).toMatch(/penalize.*innuendo.*(?:decorative|isolated|wordplay)/i)
    expect(critiquePrompt).toMatch(/headline.*(?:same|central).*double meaning/i)
    expect(critiquePrompt).toMatch(
      /passes=false.*(?:missing|lacks).*conceptual sexual double meaning/i,
    )
    expect(critiquePrompt).toContain('suggestive rather than pornographically explicit')
    expect(critiquePrompt).toContain('word-count quota')
    expect(critiquePrompt).toContain('NEVER BREAK THE FOURTH WALL')
    expect(critiquePrompt).toMatch(/passes=false.*meta-commentary/i)
    expect(rewritePrompt).toMatch(
      /(?:rebuild|rewrite).*sexual double meaning.*(?:premise|structure)/i,
    )
    expect(rewritePrompt).toMatch(/headline.*(?:same|central).*double meaning/i)
    expect(rewritePrompt).toContain('suggestive rather than pornographically explicit')
    expect(rewritePrompt).toContain('word-count quota')
    expect(rewritePrompt).toContain('NEVER BREAK THE FOURTH WALL')
  })

  it('keeps locked headline fields immutable during critique rewrites', async () => {
    process.env.SATIRE_CRITIQUE_ENABLED = 'true'
    const seedDraft = {
      headline: 'Hospital Queue Demands Firmer Submission Before Opening',
      subheadline: 'Patients discover the waiting policy prefers those willing to submit.',
      excerpt: 'Administrators promise satisfaction once everyone accepts a firmer grip.',
    }
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(bodyOnlyArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        darknessScore: 6,
        politicalCriticismScore: 6,
        discomfortScore: 6,
        specificityScore: 6,
        passes: false,
        strongestLine: 'The hospital turns waiting into public policy.',
        weaknesses: ['The central double meaning does not shape the ending.'],
        revisionInstructions: ['Deepen the locked headline concept throughout the body.'],
      }),
    })
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(fullArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        reason: 'All fields pass.',
      }),
    })

    await generateArticle({ ...makeInput(), seedDraft })

    const rewriteMessages = mocks.invoke.mock.calls[2]?.[0] as Array<{ content: string }>
    const rewritePrompt = rewriteMessages.map((message) => message.content).join('\n')

    expect(rewritePrompt).toContain('LOCKED DRAFT REWRITE MODE')
    expect(rewritePrompt).toContain(`Exact locked headline: "${seedDraft.headline}"`)
    expect(rewritePrompt).toMatch(/do not (?:return|rewrite).*headline/i)
    expect(rewritePrompt).toMatch(/deepen.*double meaning.*locked headline/i)
    expect(rewritePrompt).toContain('JSON schema (LOCKED DRAFT MODE)')
  })

  it('keeps locked headline fields immutable while translating the body', async () => {
    const seedDraft = {
      headline: 'Hospital Queue Demands Firmer Submission Before Opening',
      subheadline: 'Patients discover the waiting policy prefers those willing to submit.',
      excerpt: 'Administrators promise satisfaction once everyone accepts a firmer grip.',
    }
    const germanBody = [
      'Die Patienten stehen vor dem Krankenhaus und warten auf das Amt, das heute nicht mit ihnen arbeiten will.',
      'Der Direktor ist mit der neuen Regel zufrieden, weil die Verwaltung auf Kontrolle und auf langen Wartezeiten besteht.',
      'Das Personal erklärt, dass die Schlange nicht kürzer wird und die Bürger weiter auf eine Antwort warten müssen.',
    ].join('\n\n')
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({ ...bodyOnlyArticle, bodyMarkdown: germanBody }),
    })
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(bodyOnlyArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        reason: 'All fields pass.',
      }),
    })

    const result = await generateArticle({ ...makeInput(), seedDraft })

    const translationMessages = mocks.invoke.mock.calls[1]?.[0] as Array<{ content: string }>
    const translationPrompt = translationMessages.map((message) => message.content).join('\n')

    expect(translationPrompt).toContain('LOCKED DRAFT TRANSLATION MODE')
    expect(translationPrompt).toContain(`Exact locked headline: "${seedDraft.headline}"`)
    expect(translationPrompt).toContain('JSON schema (LOCKED DRAFT MODE)')
    expect(translationPrompt).not.toContain('"headline": string')
    expect(translationPrompt).toContain('CONCEPTUAL SEXUAL INNUENDO')
    expect(translationPrompt).toContain('NEVER BREAK THE FOURTH WALL')
    expect(result.article.headline).toBe(seedDraft.headline)
    expect(result.article.subheadline).toBe(seedDraft.subheadline)
    expect(result.article.excerpt).toBe(seedDraft.excerpt)
  })

  it('preserves the conceptual innuendo contract when repairing a locked draft', async () => {
    const seedDraft = {
      headline: 'Hospital Queue Demands Firmer Submission Before Opening',
      subheadline: 'Patients discover the waiting policy prefers those willing to submit.',
      excerpt: 'Administrators promise satisfaction once everyone accepts a firmer grip.',
    }
    mocks.invoke.mockResolvedValueOnce({ content: 'not JSON' })
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(bodyOnlyArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        reason: 'All fields pass.',
      }),
    })

    await generateArticle({ ...makeInput(), seedDraft })

    const repairMessages = mocks.invoke.mock.calls[1]?.[0] as Array<{ content: string }>
    const repairPrompt = repairMessages.map((message) => message.content).join('\n')

    expect(repairPrompt).toContain('CONCEPTUAL SEXUAL INNUENDO')
    expect(repairPrompt).toContain('suggestive rather than pornographically explicit')
    expect(repairPrompt).toContain('word-count quota')
    expect(repairPrompt).toContain(`Exact locked headline: "${seedDraft.headline}"`)
    expect(repairPrompt).toContain(`Exact locked subheadline: "${seedDraft.subheadline}"`)
    expect(repairPrompt).toContain(`Exact locked excerpt: "${seedDraft.excerpt}"`)
    expect(repairPrompt).toMatch(/body.*same.*(?:double meaning|concept)/i)
    expect(repairPrompt).toContain('NEVER BREAK THE FOURTH WALL')
  })

  it('runs a parse-error repair through the satire critique gate', async () => {
    process.env.SATIRE_CRITIQUE_ENABLED = 'true'
    mocks.invoke.mockResolvedValueOnce({ content: 'not JSON' })
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(fullArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        darknessScore: 8,
        politicalCriticismScore: 8,
        discomfortScore: 8,
        specificityScore: 8,
        passes: false,
        strongestLine: 'The hospital turns waiting into public policy.',
        weaknesses: ['The governing double meaning needs a stronger ending.'],
        revisionInstructions: ['Carry the governing double meaning into the ending.'],
      }),
    })
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(fullArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        reason: 'All fields pass.',
      }),
    })

    await generateArticle(makeInput())

    const critiqueMessages = mocks.invoke.mock.calls[2]?.[0] as Array<{ content: string }>
    const critiquePrompt = critiqueMessages.map((message) => message.content).join('\n')
    const rewriteMessages = mocks.invoke.mock.calls[3]?.[0] as Array<{ content: string }>
    const rewritePrompt = rewriteMessages.map((message) => message.content).join('\n')

    expect(critiquePrompt).toContain('satire editor scoring an article')
    expect(critiquePrompt).toContain('CONCEPTUAL SEXUAL INNUENDO')
    expect(rewritePrompt).toContain('Carry the governing double meaning into the ending.')
    expect(mocks.invoke).toHaveBeenCalledTimes(5)
  })

  it('preserves the conceptual contract when shortening a repaired locked draft', async () => {
    const seedDraft = {
      headline: 'Hospital Queue Demands Firmer Submission Before Opening',
      subheadline: 'Patients discover the waiting policy prefers those willing to submit.',
      excerpt: 'Administrators promise satisfaction once everyone accepts a firmer grip.',
    }
    mocks.invoke.mockResolvedValueOnce({ content: 'not JSON' })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        ...bodyOnlyArticle,
        imageCaption: 'x'.repeat(161),
      }),
    })
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(bodyOnlyArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        reason: 'All fields pass.',
      }),
    })

    await generateArticle({ ...makeInput(), seedDraft })

    const shortenMessages = mocks.invoke.mock.calls[2]?.[0] as Array<{ content: string }>
    const shortenPrompt = shortenMessages.map((message) => message.content).join('\n')

    expect(shortenPrompt).toContain('CONCEPTUAL SEXUAL INNUENDO')
    expect(shortenPrompt).toContain(`Exact locked headline: "${seedDraft.headline}"`)
    expect(shortenPrompt).toMatch(/body.*same.*(?:double meaning|concept)/i)
    expect(shortenPrompt).toContain('NEVER BREAK THE FOURTH WALL')
  })

  it('rejects meta-commentary identified semantically even when it evades the narrow fallback', async () => {
    mocks.invoke.mockResolvedValueOnce({ content: JSON.stringify(fullArticle) })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        metaCommentaryPass: false,
        invalidMetaField: 'bodyMarkdown',
        reason: 'The body addresses readers as an audience for a comic treatment.',
      }),
    })

    await expect(generateArticle(makeInput())).rejects.toThrow(
      'META_COMMENTARY_GUARD: bodyMarkdown',
    )
  })

  it('blocks known explicit self-description even when the semantic evaluator is unavailable', async () => {
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        ...fullArticle,
        bodyMarkdown: `${coherentBody}\n\nThe piece would satirize the civic habit of declaring danger solved from a safe studio chair.`,
      }),
    })

    await expect(generateArticle(makeInput())).rejects.toThrow(
      'META_COMMENTARY_GUARD: bodyMarkdown',
    )
    expect(mocks.invoke).toHaveBeenCalledOnce()
  })

  it('activates AfR rules and explanation when AfR mode is explicitly forced', async () => {
    const ratPartyBody = [
      'The fictional rat party arrived at the central sewer before sunrise and declared every blocked drain a protected national border.',
      'Officials issued heritage certificates while party delegates demanded purity inspections for every tunnel resident and blamed foreign rodents for municipal corrosion.',
      'By noon, the sewer authority had surrendered its maintenance budget to a patriotic cheese tribunal chaired by the party leader.',
    ].join('\n\n')
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        ...bodyOnlyArticle,
        bodyMarkdown: ratPartyBody,
        imageCaption: 'Rat-party delegates inspect a sewer border.',
        imagePrompt: 'A documentary photograph of rat-party delegates inside a Berlin sewer.',
      }),
    })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        languagePass: true,
        englishShare: 1,
        invalidField: 'none',
        germanUsageSummary: '',
        reason: 'All fields pass.',
      }),
    })

    const result = await generateArticle({
      ...makeInput(),
      forceAfR: true,
      seedDraft: {
        headline: 'Rat Party Demands Heritage Status for Sewer Borders',
        subheadline: 'The party turns a blocked drain into a nationalist emergency.',
        excerpt: 'The fictional rat party promises purity checks beneath the central sewer.',
      },
    })

    const generationMessages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const generationPrompt = generationMessages.map((message) => message.content).join('\n')

    expect(generationPrompt).toContain('AFR RECURRING STORY MODE (MANDATORY WHEN ACTIVE)')
    expect(generationPrompt).toContain('The tone must MOCK and CRITICIZE these positions')
    expect(result.article.bodyMarkdown).toContain('AfR (Alternativ für Ratten)')
  })

  it('fails closed when the final evaluator is unavailable and the headline has no English evidence', async () => {
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({ ...fullArticle, headline: 'KINDER STREIKEN HEUTE' }),
    })
    mocks.invoke.mockRejectedValueOnce(new Error('language evaluator unavailable'))

    await expect(generateArticle(makeInput())).rejects.toThrow('HEADLINE_LANGUAGE_GUARD: headline')
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
