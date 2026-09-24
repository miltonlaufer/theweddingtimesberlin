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

  it('passes structured RSS source context into draft generation', async () => {
    const rssTopics = [
      {
        source: 'berliner-zeitung',
        title: 'The chancellor faces calls to resign',
        url: 'https://news.example.test/chancellor',
        publishedAt: '2026-09-21T06:00:00.000Z',
        description: 'The report concerns Federal Chancellor Friedrich Merz.',
      },
    ]
    const response = await POST(
      new Request('https://example.test/api/internal/generation/retry-draft', {
        method: 'POST',
        body: JSON.stringify({
          jobId: 123,
          itemId: 456,
          maxAttempts: 3,
          slot: {
            forceOpinion: false,
            includeTopics: true,
            forceRss: true,
          },
          topicSummary: '- [berliner-zeitung] The chancellor faces calls to resign',
          rssTopics,
          recentCoverage: [],
          acceptedDrafts: [],
          forbiddenSourceTopics: [],
          blacklistSummary: '',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.generateDraftCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ rssTopics }),
    )
  })

  it('feeds the previous rejected draft and evaluator reason into the next attempt', async () => {
    mocks.getPayload.mockResolvedValue({
      findByID: vi.fn().mockResolvedValue({
        id: 456,
        job: 123,
        draftAttempt: 1,
        headline: 'Permit Office Makes It Personal',
        subheadline: 'Applicants face another interview.',
        excerpt: 'The office asks for more paperwork.',
        error: 'The double meaning is decorative rather than structural.',
      }),
      update: vi.fn().mockResolvedValue({}),
    })

    const response = await POST(
      new Request('https://example.test/api/internal/generation/retry-draft', {
        method: 'POST',
        body: JSON.stringify({
          jobId: 123,
          itemId: 456,
          maxAttempts: 3,
          slot: {
            forceOpinion: false,
            includeTopics: false,
          },
          topicSummary: '',
          recentCoverage: [],
          acceptedDrafts: [],
          forbiddenSourceTopics: [],
          blacklistSummary: '',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.generateDraftCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        previousAttempt: {
          draft: {
            headline: 'Permit Office Makes It Personal',
            subheadline: 'Applicants face another interview.',
            excerpt: 'The office asks for more paperwork.',
          },
          rejectionReason: 'The double meaning is decorative rather than structural.',
        },
      }),
    )
  })

  it('keeps a safe style miss rejected during the first two attempts', async () => {
    mocks.getPayload.mockResolvedValue({
      findByID: vi.fn().mockResolvedValue({
        id: 456,
        job: 123,
        draftAttempt: 1,
      }),
      update: vi.fn().mockResolvedValue({}),
    })
    mocks.evaluateDraftCandidate.mockResolvedValue({
      accepted: false,
      safeForFallback: true,
      reason: 'tone: the headline lacks either strong style lane',
      repetition: {
        overlaps: false,
        score: 0,
        reason: 'Distinct.',
        matchedReference: null,
      },
      tone: {
        funScore: 7,
        mercilessScore: 7,
        specificityScore: 7,
        conceptualInnuendoPass: false,
        surrealPataphysicsPass: false,
        metaCommentaryPass: true,
        languagePass: true,
        englishShare: 1,
        germanUsageSummary: '',
        pass: false,
        reason: 'The headline lacks either strong style lane.',
      },
    })

    const response = await POST(
      new Request('https://example.test/api/internal/generation/retry-draft', {
        method: 'POST',
        body: JSON.stringify({
          jobId: 123,
          itemId: 456,
          maxAttempts: 3,
          slot: { forceOpinion: false, includeTopics: false },
          topicSummary: '',
        }),
      }),
    )
    const payload = (await response.json()) as {
      accepted: boolean
      exhausted: boolean
      attempt: number
    }

    expect(payload).toEqual(
      expect.objectContaining({ accepted: false, exhausted: false, attempt: 2 }),
    )
  })

  it('accepts a safe style miss on the third attempt', async () => {
    const update = vi.fn().mockResolvedValue({})
    mocks.getPayload.mockResolvedValue({
      findByID: vi.fn().mockResolvedValue({
        id: 456,
        job: 123,
        draftAttempt: 2,
      }),
      update,
    })
    mocks.evaluateDraftCandidate.mockResolvedValue({
      accepted: false,
      safeForFallback: true,
      reason: 'tone: the headline lacks either strong style lane',
      repetition: {
        overlaps: false,
        score: 0,
        reason: 'Distinct.',
        matchedReference: null,
      },
      tone: {
        funScore: 7,
        mercilessScore: 7,
        specificityScore: 7,
        conceptualInnuendoPass: false,
        surrealPataphysicsPass: false,
        metaCommentaryPass: true,
        languagePass: true,
        englishShare: 1,
        germanUsageSummary: '',
        pass: false,
        reason: 'The headline lacks either strong style lane.',
      },
    })

    const response = await POST(
      new Request('https://example.test/api/internal/generation/retry-draft', {
        method: 'POST',
        body: JSON.stringify({
          jobId: 123,
          itemId: 456,
          maxAttempts: 3,
          slot: { forceOpinion: false, includeTopics: false },
          topicSummary: '',
        }),
      }),
    )
    const payload = (await response.json()) as {
      accepted: boolean
      exhausted: boolean
      attempt: number
      evaluation: { accepted: boolean; reason: string }
    }

    expect(payload).toEqual(
      expect.objectContaining({
        accepted: true,
        exhausted: false,
        attempt: 3,
        evaluation: expect.objectContaining({
          accepted: true,
          reason: expect.stringMatching(/^accepted-third-attempt:/),
        }),
      }),
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'draft-accepted',
          error: undefined,
          draftEvaluation: expect.objectContaining({ accepted: true }),
        }),
      }),
    )
  })

  it('keeps hard failures rejected on the third attempt', async () => {
    mocks.getPayload.mockResolvedValue({
      findByID: vi.fn().mockResolvedValue({
        id: 456,
        job: 123,
        draftAttempt: 2,
      }),
      update: vi.fn().mockResolvedValue({}),
    })
    mocks.evaluateDraftCandidate.mockResolvedValue({
      accepted: false,
      safeForFallback: false,
      reason: 'meta-commentary: excerpt explains the joke',
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
        conceptualInnuendoPass: true,
        surrealPataphysicsPass: true,
        metaCommentaryPass: false,
        languagePass: true,
        englishShare: 1,
        germanUsageSummary: '',
        pass: false,
        reason: 'The excerpt explains the joke.',
      },
    })

    const response = await POST(
      new Request('https://example.test/api/internal/generation/retry-draft', {
        method: 'POST',
        body: JSON.stringify({
          jobId: 123,
          itemId: 456,
          maxAttempts: 3,
          slot: { forceOpinion: false, includeTopics: false },
          topicSummary: '',
        }),
      }),
    )
    const payload = (await response.json()) as { accepted: boolean; exhausted: boolean }

    expect(payload).toEqual(expect.objectContaining({ accepted: false, exhausted: true }))
  })
})
