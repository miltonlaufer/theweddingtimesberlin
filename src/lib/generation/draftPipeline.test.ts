import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateDraftCandidate, generateDraftCandidate } from './draftPipeline'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(() => ({
    invoke: mocks.invoke,
  })),
}))

describe('generateDraftCandidate', () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey
    mocks.invoke.mockReset()
  })

  it('treats configured RSS source tags as RSS topics for forced RSS slots', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Senate Discovers a Queue With Feelings',
        subheadline: 'A procedural scandal becomes a civic personality test.',
        excerpt: 'Officials insist the queue is temporary, despite giving it a desk.',
      }),
    })

    const result = await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: true,
        forceOpinion: false,
        includeTopics: true,
      },
      topicSummary: '- [nytimes] Senate discovers the queue is sentient',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      forbiddenSourceTopics: [],
      useRandomModes: false,
    })

    expect(result.sourceRssTopic).toBe('Senate discovers the queue is sentient')
    expect(mocks.invoke).toHaveBeenCalledOnce()
    expect(JSON.stringify(mocks.invoke.mock.calls[0]?.[0])).toContain(
      'Assigned topic/news hook: Senate discovers the queue is sentient',
    )
  })

  it('activates explicit AfR pitch mode for a forced AfR slot', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Rat Party Demands Heritage Status for Sewer Borders',
        subheadline: 'Alice Rattenweidel promises purity checks beneath the central sewer.',
        excerpt: 'The fictional AfR turns a blocked drain into a nationalist emergency.',
      }),
    })

    await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: false,
        forceAfR: true,
        forceOpinion: false,
        includeTopics: false,
      },
      topicSummary: '- [nytimes] An unrelated current-news topic',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      useRandomModes: false,
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toContain(
      'Mode: This pitch must center the fictional far-right rat party Alternativ für Ratten (AfR)',
    )
    expect(combined).toContain('No fixed topic: choose a fresh one.')
  })

  it('puts the English-led policy before a German RSS topic', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'AfD Campaign Turns Insults Into Applause',
        subheadline: 'The opening event packages brutality as authenticity.',
        excerpt: 'Campaigners hope the crowd mistakes bullying for courage.',
      }),
    })

    await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: true,
        forceOpinion: false,
        includeTopics: true,
      },
      topicSummary: '- [berliner-zeitung] „Du Arschloch, was soll das?“ Wahlkampfauftakt der AfD',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      useRandomModes: false,
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')
    expect(combined).toContain('at least 60% of classified language words must be English')
    expect(combined).toContain(
      'Proper names, place names, acronyms, numbers, and punctuation are excluded from the denominator',
    )
    expect(combined.indexOf('HEADLINE LANGUAGE POLICY')).toBeLessThan(
      combined.indexOf('Assigned topic/news hook'),
    )
  })

  it('requires the pitch headline to carry the story’s conceptual sexual double meaning', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Bürgeramt Promises a Firmer Grip on Every Application',
        subheadline: 'The office turns administrative control into an intimacy problem.',
        excerpt: 'Officials insist the new procedure is satisfying once residents submit.',
      }),
    })

    await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: false,
        forceOpinion: false,
        includeTopics: false,
      },
      topicSummary: '',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      useRandomModes: false,
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toMatch(/sexual double meaning.*(?:premise|comedic engine)/i)
    expect(combined).toMatch(/headline.*(?:carry|express).*(?:same|central).*double meaning/i)
    expect(combined).toMatch(/not.*(?:dirty words|suggestive phrases|word-count quota)/i)
  })

  it('makes conceptual headline innuendo part of draft tone evaluation', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        languagePass: true,
        englishShare: 1,
        germanUsageSummary: '',
        pass: true,
        reason: 'Accepted.',
      }),
    })

    await evaluateDraftCandidate({
      candidate: {
        headline: 'Bürgeramt Promises a Firmer Grip on Every Application',
        subheadline: 'The office turns administrative control into an intimacy problem.',
        excerpt: 'Officials insist the new procedure is satisfying once residents submit.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toMatch(/headline.*conceptual sexual double meaning/i)
    expect(combined).toMatch(
      /headline, subheadline, and excerpt.*one coherent.*(?:mechanism|concept)/i,
    )
    expect(combined).toMatch(/(?:reject|pass=false).*merely.*(?:dirty word|suggestive phrase)/i)
  })

  it('rejects a German-dominant draft before invoking the tone evaluator', async () => {
    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Du Arschloch, jetzt bitte mit Applaus',
        subheadline: 'Campaigners package brutality as authenticity.',
        excerpt: 'The crowd mistakes bullying for courage.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('headline-language:')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('rejects an evaluator-detected language violation that passes local heuristics', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        languagePass: false,
        englishShare: 0.4,
        germanUsageSummary: 'German clause dominates the headline',
        pass: false,
        reason: 'Language policy failed.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Nachtschicht Rules the Founder Economy',
        subheadline: 'A startup discovers that exhaustion can be invoiced.',
        excerpt: 'Founders turn late work into a branded moral hierarchy.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('headline-language:')
  })

  it('rejects evaluator-detected non-English supporting text that passes local heuristics', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        languagePass: false,
        englishShare: 1,
        germanUsageSummary: 'The subheadline is Italian rather than US English.',
        pass: false,
        reason: 'Supporting text language policy failed.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Ashtray Diplomacy Controls the Night Shift',
        subheadline: 'I pazienti aspettano mentre lo sportello chiude.',
        excerpt: 'The hospital turns waiting into a branded public service.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('headline-language:')
    expect(evaluation.reason).toContain('subheadline')
  })

  it('does not let evaluator outage fallback override an uppercase deterministic rejection', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockRejectedValue(new Error('evaluator unavailable'))

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'DU ARSCHLOCH, JETZT BITTE MIT APPLAUS',
        subheadline: 'The campaign packages brutality as authenticity.',
        excerpt: 'The crowd mistakes bullying for courage.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('headline-language:')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('fails closed on evaluator outage when a headline has no deterministic English evidence', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockRejectedValue(new Error('evaluator unavailable'))

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'KINDER STREIKEN HEUTE',
        subheadline: 'The campaign packages delay as public service.',
        excerpt: 'The hospital turns waiting into a branded moral hierarchy.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('headline-language:')
    expect(mocks.invoke).toHaveBeenCalledOnce()
  })

  it('fails closed when the semantic tone evaluator is unavailable', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockRejectedValue(new Error('evaluator unavailable'))

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Nachtschicht Rules the Founder Economy',
        subheadline: 'A startup discovers that exhaustion can be invoiced.',
        excerpt: 'Founders turn late work into a branded moral hierarchy.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.tone.reason).toContain('evaluator unavailable')
  })

  it.each([
    {
      field: 'subheadline',
      subheadline: 'Die crowd packages brutality as authenticity.',
      excerpt: 'Campaigners hope the crowd mistakes bullying for courage.',
    },
    {
      field: 'excerpt',
      subheadline: 'Campaigners package brutality as authenticity.',
      excerpt: 'Die crowd mistakes bullying for courage.',
    },
  ])('rejects a German $field before invoking the tone evaluator', async (candidate) => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        languagePass: true,
        englishShare: 1,
        germanUsageSummary: '',
        pass: true,
        reason: 'Accepted.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Ashtray Diplomacy Controls the Night Shift',
        subheadline: candidate.subheadline,
        excerpt: candidate.excerpt,
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('headline-language:')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
