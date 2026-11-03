import type { DraftCandidate, RecentCoverageItem } from './pipelineTypes'

export type StyleDiversityAssessment = { pass: boolean; reason: string; signals: string[] }

const TROPES = [
  { key: 'foreplay', pattern: /\bfore[ -]?play\b/i },
  { key: 'submission', pattern: /\b(?:submission|submissive|submit(?:s|ted|ting)?)\b/i },
  { key: 'climax', pattern: /\b(?:climax(?:es|ing)?|orgasm\w*)\b/i },
  { key: 'premature-finish', pattern: /\bpremature(?:ly)?\b/i },
  { key: 'penetration', pattern: /\b(?:penetrat\w*|deep[ -]throat\w*)\b/i },
]
const FIGURES =
  /\b(hamlet|ophelia|macbeth|othello|kafka|faust|sisyphus|godot|odysseus|ulysses|don quixote|proust|orwell|nietzsche|freud|dante|socrates|shakespeare)\b/i
const PLACEMENT =
  /^(?:hamlet|ophelia|macbeth|othello|kafka|faust|sisyphus|godot|odysseus|ulysses|don quixote|proust|orwell|nietzsche|freud|dante|socrates|shakespeare)\s+(?:in|at|im|am|auf)\b/i

function text(draft: {
  headline: string
  subheadline?: string | null
  excerpt?: string | null
}): string {
  return [draft.headline, draft.subheadline, draft.excerpt].filter(Boolean).join(' ')
}

function saturatedTropes(recent: RecentCoverageItem[], batch: DraftCandidate[]): typeof TROPES {
  return TROPES.filter(
    ({ pattern }) =>
      batch.some((draft) => pattern.test(text(draft))) ||
      recent.slice(0, 24).filter((draft) => pattern.test(text(draft))).length >= 2,
  )
}

export const STYLE_DIVERSITY_GUIDANCE = [
  'STYLE DIVERSITY:',
  '- A different news topic does not make a recycled sexual metaphor fresh. Invent a different governing relationship, not a synonym for the same stock sexual label.',
  '- Avoid the decorative headline scaffold that drops a famous fictional character, writer, or philosopher into a local venue. Merely replacing the figure or the place repeats the same joke.',
  '- Let the actual subject do something specific in the headline. Cultural allusions should transform that action or sharpen the social accusation; a reference is optional.',
].join('\n')

export function buildStyleDiversityGuidance(
  recentCoverage: RecentCoverageItem[],
  acceptedDrafts: DraftCandidate[] = [],
): string {
  const saturated = saturatedTropes(recentCoverage, acceptedDrafts).map(({ key }) => key)
  return [
    STYLE_DIVERSITY_GUIDANCE,
    saturated.length
      ? `Overused sexual devices in recent/current-batch coverage: ${saturated.join(', ')}. Choose a different mechanism; do not just rename these devices.`
      : 'Choose a mechanism distinct from recent coverage and other pitches in this batch.',
  ].join('\n')
}

export function assessStyleDiversity(params: {
  candidate: DraftCandidate
  recentCoverage: RecentCoverageItem[]
  acceptedDrafts: DraftCandidate[]
}): StyleDiversityAssessment {
  const signals = saturatedTropes(params.recentCoverage, params.acceptedDrafts)
    .filter(({ pattern }) => pattern.test(text(params.candidate)))
    .map(({ key }) => `sexual-trope:${key}`)
  if (PLACEMENT.test(params.candidate.headline.trim())) signals.push('cultural-placement-template')
  const figure = params.candidate.headline.match(FIGURES)?.[1]?.toLowerCase()
  if (figure) {
    const usesFigure = (draft: { headline: string }) =>
      draft.headline.match(FIGURES)?.[1]?.toLowerCase() === figure
    if (
      params.acceptedDrafts.some(usesFigure) ||
      params.recentCoverage.slice(0, 24).filter(usesFigure).length >= 2
    ) {
      signals.push(`repeated-cultural-figure:${figure}`)
    }
  }
  return {
    pass: signals.length === 0,
    signals,
    reason: signals.length
      ? `Overused style (${signals.join(', ')}). Preserve the news topic but rewrite the governing sexual mechanism and headline structure.`
      : 'Fresh style.',
  }
}

// Vary the reporting question rather than supplying sexual phrases to imitate.
const EDITORIAL_QUESTIONS = [
  'whose public promise conflicts with their actual behavior',
  'who sets the terms and who pays the hidden cost',
  'what the institution measures instead of the thing it claims to deliver',
  'whose supposed convenience creates extra work for someone else',
  'which ordinary procedure exposes a status difference',
  'who benefits when the stated solution fails',
  'what the official wording accidentally admits',
  'what changes when a private incentive becomes a public rule',
]

export function buildBatchStyleDirections(
  count: number,
  recentCoverage: RecentCoverageItem[],
): string[] {
  const offset = recentCoverage.length % EDITORIAL_QUESTIONS.length
  return Array.from({ length: count }, (_, index) => {
    const question = EDITORIAL_QUESTIONS[(offset + index) % EDITORIAL_QUESTIONS.length]
    return `Reporting direction for this slot: investigate ${question} in the assigned subject. Derive the double meaning from its ordinary language; do not impose a sexual scenario. Keep the mechanism distinct from recent coverage and other slots.`
  })
}
