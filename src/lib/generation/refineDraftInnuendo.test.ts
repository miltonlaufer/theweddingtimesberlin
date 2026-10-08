import { describe, expect, it } from 'vitest'
import {
  draftQualityScore,
  refineDraftInnuendo,
  summarizeDraftInnuendo,
  summarizeBatchDraftInnuendo,
} from './refineDraftInnuendo'
import type { DraftCandidate, DraftEvaluation } from './pipelineTypes'

const original: DraftCandidate = {
  headline: 'Permit Office Adds Another Interview',
  subheadline: 'Applicants face another interview.',
  excerpt: 'The office asks for more paperwork.',
}
const revised: DraftCandidate = {
  headline: 'Permit Office Demands a More Convincing Submission',
  subheadline: 'Applicants discover that compliance is the only intimacy on offer.',
  excerpt: 'The office turns bodily compliance and paperwork into the same ritual.',
}
function evaluation(innuendo: boolean, extra: Partial<DraftEvaluation> = {}): DraftEvaluation {
  return {
    accepted: innuendo,
    safeForFallback: true,
    reason: innuendo ? 'accepted' : 'tone: missing innuendo',
    repetition: { overlaps: false, score: 0, reason: 'distinct', matchedReference: null },
    tone: {
      funScore: 8,
      mercilessScore: 8,
      specificityScore: 8,
      conceptualInnuendoPass: innuendo,
      surrealPataphysicsPass: false,
      metaCommentaryPass: true,
      languagePass: true,
      englishShare: 1,
      germanUsageSummary: '',
      pass: innuendo,
      reason: 'tone',
    },
    ...extra,
  }
}

describe('refineDraftInnuendo', () => {
  it('revises a safe pitch before locking it and returns the improved fields', async () => {
    const result = await refineDraftInnuendo({
      draft: original,
      evaluation: evaluation(false),
      revise: async () => revised,
      evaluate: async () => evaluation(true),
    })
    expect(result.draft).toEqual(revised)
    expect(result.evaluation.tone.conceptualInnuendoPass).toBe(true)
  })

  it('keeps all six safe slots usable when innuendo checks fail throughout', async () => {
    let revisions = 0
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        refineDraftInnuendo({
          draft: { ...original, headline: `Permit Office Adds Interview ${index}` },
          evaluation: evaluation(false),
          revise: async (draft) => {
            revisions++
            return { ...draft, subheadline: 'The office still asks for paperwork.' }
          },
          evaluate: async () => evaluation(false),
        }),
      ),
    )
    expect(results).toHaveLength(6)
    expect(results.every((result) => result.evaluation.safeForFallback)).toBe(true)
    expect(revisions).toBe(12)
  })

  it('keeps the original safe draft when revisions or evaluation are unavailable', async () => {
    const result = await refineDraftInnuendo({
      draft: original,
      evaluation: evaluation(false),
      revise: async () => revised,
      evaluate: async () => {
        throw new Error('Evaluator unavailable')
      },
    })
    expect(result.draft).toEqual(original)
    expect(result.evaluation.safeForFallback).toBe(true)
    expect(result.evaluation.innuendoRevision?.attempts).toBe(2)
  })

  it('uses the latest failed evaluation as feedback for the second revision', async () => {
    const feedback: string[] = []
    await refineDraftInnuendo({
      draft: original,
      evaluation: evaluation(false),
      revise: async (_, verdict) => {
        feedback.push(verdict.reason)
        return revised
      },
      evaluate: async () => evaluation(false, { reason: 'tone: double meaning is disconnected' }),
    })
    expect(feedback).toEqual(['tone: missing innuendo', 'tone: double meaning is disconnected'])
  })

  it('never replaces a safe original with a revision that fails a hard gate', async () => {
    const result = await refineDraftInnuendo({
      draft: original,
      evaluation: evaluation(false),
      revise: async () => revised,
      evaluate: async () => evaluation(true, { accepted: false, safeForFallback: false }),
    })
    expect(result.draft).toEqual(original)
  })

  it('does not revise a hard rejection or a pitch with recognized innuendo', async () => {
    for (const verdict of [evaluation(false, { safeForFallback: false }), evaluation(true)]) {
      const result = await refineDraftInnuendo({
        draft: original,
        evaluation: verdict,
        revise: async () => {
          throw new Error('Must not revise')
        },
        evaluate: async () => evaluation(true),
      })
      expect(result.evaluation).toEqual(verdict)
    }
  })

  it('ranks recognized innuendo above a stronger surreal-only pitch', () => {
    const surreal = evaluation(false)
    surreal.tone = {
      ...surreal.tone,
      surrealPataphysicsPass: true,
      funScore: 10,
      mercilessScore: 10,
      specificityScore: 10,
    }
    expect(draftQualityScore(evaluation(true))).toBeGreaterThan(draftQualityScore(surreal))
  })

  it('reports missing innuendo separately from unavailable evaluation', () => {
    const unknown = evaluation(false)
    unknown.tone.evaluatorAvailable = false
    expect(
      summarizeDraftInnuendo([evaluation(true), evaluation(false), unknown, undefined]),
    ).toEqual({
      selectedDrafts: 4,
      recognizedInnuendoDrafts: 1,
      missingInnuendoDrafts: 1,
      unverifiedDrafts: 2,
    })
  })

  it('counts an accepted pitch even when its article fails to generate', () => {
    expect(
      summarizeBatchDraftInnuendo([
        { status: 'completed', draftEvaluation: evaluation(true) },
        { status: 'failed', draftEvaluation: evaluation(true) },
        {
          status: 'draft-rejected',
          draftEvaluation: evaluation(false, { safeForFallback: false }),
        },
      ]),
    ).toEqual({
      plannedSlots: 3,
      selectedDrafts: 2,
      recognizedInnuendoDrafts: 2,
      missingInnuendoDrafts: 0,
      unverifiedDrafts: 0,
    })
  })
})
