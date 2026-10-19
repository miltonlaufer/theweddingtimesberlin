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

const MECHANISMS = [
  {
    name: 'seduction and withholding',
    pattern: /\b(?:foreplay|seduc\w*|withhold\w*)\b/i,
    detail: 'desire for access versus calculated refusal',
  },
  {
    name: 'power and negotiated consent',
    pattern: /\b(?:consent|permission|submit\w*|submission)\b/i,
    detail: 'who sets the terms and whose agreement is taken for granted',
  },
  {
    name: 'performance anxiety',
    pattern: /\b(?:performance|premature\w*|climax\w*)\b/i,
    detail: 'promises of potency versus the pressure to deliver under scrutiny',
  },
  {
    name: 'commitment and infidelity',
    pattern: /\b(?:loyal\w*|infidel\w*|commitment)\b/i,
    detail: 'professed loyalty versus opportunistic switching of partners',
  },
  {
    name: 'exposure and voyeurism',
    pattern: /\b(?:expos\w*|voyeur\w*|naked|privacy)\b/i,
    detail: 'who gets to watch and who is made vulnerable in public',
  },
  {
    name: 'appetite and satisfaction',
    pattern: /\b(?:appetite|satisf\w*|hunger|orgasm\w*)\b/i,
    detail: 'whose demands are serviced and who remains unsatisfied',
  },
  {
    name: 'jealousy and exclusivity',
    pattern: /\b(?:jealous\w*|exclusive\w*|rival\w*)\b/i,
    detail: 'competition to be desired versus attempts to possess the other party',
  },
  {
    name: 'intimacy and emotional distance',
    pattern: /\b(?:intima\w*|detachment|distance)\b/i,
    detail: 'demands for closeness versus refusal to reciprocate',
  },
]

export function buildBatchStyleDirections(
  count: number,
  recentCoverage: RecentCoverageItem[],
): string[] {
  const ranked = MECHANISMS.map((mechanism, index) => ({
    ...mechanism,
    index,
    uses: recentCoverage.slice(0, 24).filter((draft) => mechanism.pattern.test(text(draft))).length,
  })).sort((a, b) => a.uses - b.uses || a.index - b.index)
  return Array.from({ length: count }, (_, index) => {
    const mechanism = ranked[index % ranked.length]
    return `Sexual mechanism direction for this slot: ${mechanism.name}; explore ${mechanism.detail} through the actual topic. Develop the relationship, do not paste the mechanism's label into the headline. Other slots receive different directions; avoid replacing this with an overused stock trope.`
  })
}
