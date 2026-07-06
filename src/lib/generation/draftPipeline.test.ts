import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateDraftCandidate } from './draftPipeline'

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
})
