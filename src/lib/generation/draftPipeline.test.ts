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
    expect(combined.indexOf('HEADLINE LANGUAGE POLICY')).toBeLessThan(
      combined.indexOf('Assigned topic/news hook'),
    )
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
})
