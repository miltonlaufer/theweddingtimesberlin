import type { DraftCandidate, DraftEvaluation } from './pipelineTypes'

export function summarizeBatchDraftInnuendo(
  items: Array<{
    status?: string
    draftEvaluation?: DraftEvaluation
  }>,
) {
  return {
    plannedSlots: items.length,
    ...summarizeDraftInnuendo(
      items
        .filter((item) => item.status === 'completed' || item.draftEvaluation?.accepted)
        .map((item) => item.draftEvaluation),
    ),
  }
}

export function summarizeDraftInnuendo(evaluations: Array<DraftEvaluation | undefined>) {
  return {
    selectedDrafts: evaluations.length,
    recognizedInnuendoDrafts: evaluations.filter(
      (evaluation) =>
        evaluation?.tone?.evaluatorAvailable !== false &&
        evaluation?.tone?.conceptualInnuendoPass === true,
    ).length,
    missingInnuendoDrafts: evaluations.filter(
      (evaluation) =>
        evaluation?.tone?.evaluatorAvailable !== false &&
        evaluation?.tone?.conceptualInnuendoPass === false,
    ).length,
    unverifiedDrafts: evaluations.filter(
      (evaluation) =>
        !evaluation?.tone ||
        typeof evaluation.tone.conceptualInnuendoPass !== 'boolean' ||
        evaluation.tone.evaluatorAvailable === false,
    ).length,
  }
}

export function draftQualityScore(evaluation: DraftEvaluation): number {
  return (
    (evaluation.tone.conceptualInnuendoPass ? 1000 : 0) +
    (evaluation.tone.surrealPataphysicsPass ? 100 : 0) +
    evaluation.tone.funScore +
    evaluation.tone.mercilessScore +
    evaluation.tone.specificityScore
  )
}

export async function refineDraftInnuendo(params: {
  draft: DraftCandidate
  evaluation: DraftEvaluation
  maxRevisions?: number
  revise: (draft: DraftCandidate, evaluation: DraftEvaluation) => Promise<DraftCandidate>
  evaluate: (draft: DraftCandidate) => Promise<DraftEvaluation>
}): Promise<{ draft: DraftCandidate; evaluation: DraftEvaluation }> {
  const maxRevisions = Math.max(0, Math.min(2, params.maxRevisions ?? 2))
  if (
    !params.evaluation.safeForFallback ||
    params.evaluation.tone.conceptualInnuendoPass ||
    maxRevisions === 0
  ) {
    return { draft: params.draft, evaluation: params.evaluation }
  }
  let best = { draft: params.draft, evaluation: params.evaluation }
  let current = best
  let attempts = 0
  let failures = 0
  for (; attempts < maxRevisions; ) {
    attempts++
    try {
      const draft = await params.revise(current.draft, current.evaluation)
      const evaluation = await params.evaluate(draft)
      if (evaluation.safeForFallback) current = { draft, evaluation }
      if (
        evaluation.safeForFallback &&
        draftQualityScore(evaluation) > draftQualityScore(best.evaluation)
      ) {
        best = { draft, evaluation }
      }
      if (best.evaluation.tone.conceptualInnuendoPass) break
    } catch {
      // Style repair must never discard the original safe pitch or lose a slot.
      failures++
    }
  }
  return {
    draft: best.draft,
    evaluation: {
      ...best.evaluation,
      innuendoRevision: {
        attempts,
        failures,
        improved: best.draft !== params.draft,
      },
    },
  }
}
