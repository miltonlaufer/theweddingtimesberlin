import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
  generateDraftCandidate: vi.fn(),
  evaluateDraftCandidate: vi.fn(),
}))

vi.mock('@/lib/payload', () => ({
  getPayload: mocks.getPayload,
}))

vi.mock('@/lib/generation/internalAuth', () => ({
  isInternalCronAuthorized: () => true,
}))

vi.mock('@/lib/generation/draftPipeline', () => ({
  generateDraftCandidate: mocks.generateDraftCandidate,
  evaluateDraftCandidate: mocks.evaluateDraftCandidate,
}))

describe('retry-draft route', () => {
  beforeEach(() => {
    mocks.getPayload.mockReset()
    mocks.generateDraftCandidate.mockReset()
    mocks.evaluateDraftCandidate.mockReset()

    mocks.getPayload.mockResolvedValue({
      findByID: vi.fn().mockResolvedValue({
        id: 456,
        job: 123,
        draftAttempt: 0,
      }),
      update: vi.fn().mockResolvedValue({}),
    })
    mocks.generateDraftCandidate.mockResolvedValue({
      draft: {
        headline: 'Rat Party Demands Heritage Status for Sewer Borders',
        subheadline: 'A blocked drain becomes a nationalist emergency.',
        excerpt: 'The fictional rat party promises purity checks beneath the central sewer.',
      },
      sourceRssTopic: null,
    })
    mocks.evaluateDraftCandidate.mockResolvedValue({
      accepted: true,
      reason: 'Accepted.',
      repetition: {
        overlaps: false,
        score: 0,
        reason: 'Distinct.',
        matchedReference: null,
      },
      tone: {
        funScore: 9,
        mercilessScore: 9,
        specificityScore: 9,
        languagePass: true,
        englishShare: 1,
        germanUsageSummary: '',
        pass: true,
        reason: 'Accepted.',
      },
    })
  })

  it('preserves forced AfR mode when generating a draft', async () => {
    const request = new Request('https://example.test/api/internal/generation/retry-draft', {
      method: 'POST',
      body: JSON.stringify({
        jobId: 123,
        itemId: 456,
        maxAttempts: 3,
        slot: {
          forceAfR: true,
          forceOpinion: false,
          includeTopics: false,
        },
        topicSummary: '',
        recentCoverage: [],
        acceptedDrafts: [],
        forbiddenSourceTopics: [],
        blacklistSummary: '',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mocks.generateDraftCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: expect.objectContaining({ forceAfR: true }),
      }),
    )
  })
})
