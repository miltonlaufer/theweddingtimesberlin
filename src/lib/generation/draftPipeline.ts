import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import { hasMetaSummaryVoice, normalizeOptionalExcerptForStorage } from '@/lib/text/excerptQuality'
import { normalizeOptionalSubheadlineForStorage } from '@/lib/text/subheadline'
import {
  ACID_HUMOR_REQUIREMENTS,
  ANTI_META_COMMENTARY_RULES,
  analyzeHeadlineStructures,
  assessHeadlineTaste,
  assessHeadlineSimilarity,
  assessRecentCoverageOverlap,
  CRAZY_HEADLINE_REQUIREMENTS,
  CULTURAL_REFERENCE_HEADLINE_GUIDANCE,
  HUMOR_PERSPECTIVE_METHOD,
  MICRO_DETAIL_FORMULA_GUARD,
  shouldIncludeHumorPerspectiveMethod,
  WEDDING_REMINDER_SHORT,
} from '@/lib/generation/generateArticle'
import {
  assessHeadlineLanguage,
  assessSupportingTextLanguage,
  HEADLINE_LANGUAGE_POLICY_PROMPT,
} from '@/lib/generation/headlineLanguage'
import { buildRssGroundingPrompt, resolveRssTopicContext } from './rssGrounding'
import type { RssTopic } from '@/lib/rss/fetchRssTopics'
import type {
  DraftCandidate,
  DraftEvaluation,
  RecentCoverageItem,
  SlotConfig,
} from './pipelineTypes'

const DraftCandidateSchema = z.object({
  headline: z.string().min(10).max(140),
  subheadline: z.string().max(220).optional().nullable(),
  excerpt: z.string().max(300).optional().nullable(),
})

const RawDraftCandidateSchema = z.object({
  headline: z.coerce.string(),
  subheadline: z.coerce.string().optional().nullable(),
  excerpt: z.coerce.string().optional().nullable(),
})

const DraftToneSchema = z.object({
  funScore: z.number().int().min(1).max(10),
  mercilessScore: z.number().int().min(1).max(10),
  specificityScore: z.number().int().min(1).max(10),
  conceptualInnuendoPass: z.boolean(),
  surrealPataphysicsPass: z.boolean().default(false),
  metaCommentaryPass: z.boolean(),
  pass: z.boolean(),
  reason: z.string().max(300),
})

const DRAFT_STRONG_HEADLINE_STYLE_REQUIREMENTS = [
  'STRONG HEADLINE STYLE GATE:',
  '- The headline must fully realize at least one strong engine: a conceptual sexual double meaning OR a genuinely surreal/pataphysical mechanism that reorganizes real-world logic.',
  '- Aim for both when they reinforce each other, but one fully realized engine is enough.',
  '- For the sexual lane, connect the literal and sexual readings through the same power dynamic and social accusation.',
  '- For the surreal/pataphysical lane, make an impossible rule, object, institution, or physical fact govern the story while everyone treats it as ordinary procedure.',
  '- Random dirty words, disconnected suggestive phrases, odd nouns, dream images, or merely weird wording do not count.',
].join('\n')

function extractFirstJsonObject(text: string): string {
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model did not return a JSON object')
  }
  return text.slice(firstBrace, lastBrace + 1)
}

type TopicSource = 'rss' | 'manual' | 'hint' | 'unknown'

const RSS_TOPIC_SOURCE_TAGS = new Set(['rss', 'hint', 'nytimes', 'berliner-zeitung'])

type ParsedTopicLine = {
  source: TopicSource
  value: string
}

function parseTopicLine(line: string): ParsedTopicLine | null {
  const withoutBullet = line.trim().replace(/^-+\s*/, '')
  if (!withoutBullet) return null

  const sourceTagged = withoutBullet.match(/^\[([^\]]+)\]\s*(.+)$/)
  if (!sourceTagged?.[2]) {
    return { source: 'unknown', value: withoutBullet }
  }

  const sourceRaw = sourceTagged[1]?.trim().toLowerCase() ?? ''
  const value = sourceTagged[2].trim()
  if (!value) return null

  if (RSS_TOPIC_SOURCE_TAGS.has(sourceRaw)) {
    return { source: sourceRaw === 'hint' ? 'hint' : 'rss', value }
  }
  if (sourceRaw === 'manual') {
    return { source: 'manual', value }
  }
  return { source: 'unknown', value }
}

function parseTopicSummary(topicSummary: string): ParsedTopicLine[] {
  return topicSummary
    .trim()
    .split('\n')
    .map((line) => parseTopicLine(line))
    .filter((line): line is ParsedTopicLine => line != null)
}

function normalizeTopicIdentity(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

function pickTopicForSlot(
  slot: SlotConfig,
  topicSummary: string,
  forbiddenSourceTopics: string[],
  useRandomModes: boolean,
): ParsedTopicLine | null {
  const topicLines = parseTopicSummary(topicSummary)
  const forbidden = new Set(
    forbiddenSourceTopics.map(normalizeTopicIdentity).filter((line) => line.length > 0),
  )
  const allowedTopics = topicLines.filter(
    (line) => !forbidden.has(normalizeTopicIdentity(line.value)),
  )
  const allowReuseWhenExhausted =
    (process.env.DRAFT_ALLOW_RSS_TOPIC_REUSE_WHEN_EXHAUSTED ?? 'false') === 'true'
  const rssTopics = topicLines.filter((line) => line.source === 'rss' || line.source === 'hint')
  const allowedRssTopics = allowedTopics.filter(
    (line) => line.source === 'rss' || line.source === 'hint',
  )

  if (topicLines.length === 0) return null
  if (slot.forceRss) {
    if (allowedRssTopics.length > 0) {
      return useRandomModes
        ? (allowedRssTopics[Math.floor(Math.random() * allowedRssTopics.length)] ?? null)
        : (allowedRssTopics[0] ?? null)
    }
    return allowReuseWhenExhausted
      ? useRandomModes
        ? (rssTopics[Math.floor(Math.random() * rssTopics.length)] ?? null)
        : (rssTopics[0] ?? null)
      : null
  }
  if (!slot.includeTopics) return null
  if (allowedTopics.length > 0) {
    return useRandomModes
      ? (allowedTopics[Math.floor(Math.random() * allowedTopics.length)] ?? null)
      : (allowedTopics[0] ?? null)
  }
  return allowReuseWhenExhausted
    ? useRandomModes
      ? (topicLines[Math.floor(Math.random() * topicLines.length)] ?? null)
      : (topicLines[0] ?? null)
    : null
}

function buildModeInstruction(slot: SlotConfig, includeBerlinThemes: boolean): string {
  if (slot.forceAfR) {
    return 'This pitch must center the fictional far-right rat party Alternativ für Ratten (AfR), led by Alice Rattenweidel, and mock its politics without endorsement.'
  }
  if (slot.forceOpinion) {
    return 'This pitch must be an opinion/editorial angle with strong, direct point of view.'
  }
  if (slot.forceDrugsTechno) {
    return includeBerlinThemes
      ? 'This pitch must center Berlin drugs/techno/nightlife culture.'
      : 'This pitch must center drugs/techno/nightlife culture.'
  }
  if (slot.forceStartup) {
    return 'This pitch must center startup culture, gentrification dynamics, expat/status signaling, co-working culture, or wellness-capitalism themes. Avoid defaulting to rent/housing as the main punchline unless the angle is unusually specific and fresh.'
  }
  if (slot.forceRss) {
    return 'This pitch must clearly satirize the assigned current-news topic.'
  }
  return includeBerlinThemes
    ? 'Pick a fresh local Berlin satire angle that avoids repetition.'
    : 'Pick a fresh satirical angle that avoids repetition.'
}

export function buildDraftPerspectiveRuleLines(includeHumorEngine: boolean): string[] {
  if (includeHumorEngine) {
    return [
      '- Main rule: find an under-noticed detail and make the contradiction the comedic core.',
      '- If the contradiction is weak or generic, reject and rethink the pitch angle.',
      '- The pitch must contain social bite, not just a mechanism. Someone recognizable should look ridiculous, hypocritical, cowardly, vain, greedy, or performative.',
      '- If the pitch reads like smart urban observation but not an actual joke with teeth, reject it.',
      '- Do NOT use the exact phrase "overlooked detail" in the headline, subheadline, or excerpt.',
    ]
  }

  return [
    '- Find a specific satirical angle with concrete stakes, not a generic topic summary.',
    '- If the angle is weak, toothless, or generic, reject and rethink the pitch angle.',
    '- The pitch must contain social bite, not just a mechanism. Someone recognizable should look ridiculous, hypocritical, cowardly, vain, greedy, or performative.',
    '- If the pitch reads like smart urban observation but not an actual joke with teeth, reject it.',
  ]
}

function buildReferenceLines(items: RecentCoverageItem[], max = 25): string {
  return items
    .slice(0, max)
    .map((item, idx) => {
      const excerpt = item.excerpt.trim()
      return excerpt
        ? `${idx + 1}. ${item.headline} — ${excerpt.slice(0, 160)}`
        : `${idx + 1}. ${item.headline}`
    })
    .join('\n')
}

function normalizeDraft(candidate: DraftCandidate): DraftCandidate {
  return {
    headline: candidate.headline.trim().slice(0, 140),
    subheadline: normalizeOptionalSubheadlineForStorage(candidate.subheadline) ?? null,
    excerpt: normalizeOptionalExcerptForStorage(candidate.excerpt, 300) ?? null,
  }
}

function buildHeadlineSimilarityReferenceTitles(params: {
  recentCoverage: RecentCoverageItem[]
  acceptedDrafts: DraftCandidate[]
}): string[] {
  return [
    ...params.recentCoverage.map((item) => item.headline.trim()),
    ...params.acceptedDrafts.map((item) => item.headline.trim()),
  ].filter((headline) => headline.length > 0)
}

function buildHeadlineSimilarityGuardSection(params: {
  recentCoverage: RecentCoverageItem[]
  acceptedDrafts: DraftCandidate[]
}): string {
  const referenceTitles = buildHeadlineSimilarityReferenceTitles(params)
  const headlineAnalysis = analyzeHeadlineStructures(referenceTitles)

  if (referenceTitles.length === 0) {
    return ''
  }

  return [
    'TITLE SIMILARITY GUARD (MANDATORY):',
    'The headline must not look like a sibling of any recent or already accepted headline.',
    'Similarity includes shared title fingerprints, repeated phrase skeletons, close word order, high character overlap, or near-template reuse.',
    'Changing only the topic nouns is not enough; write a title that reads distinctly different as a full headline.',
    headlineAnalysis.overusedOpenings.length > 0
      ? [
          'Recent repeated title fingerprints:',
          headlineAnalysis.overusedOpenings.map((opening) => `- ${opening}`).join('\n'),
        ].join('\n')
      : '',
    'A draft is rejected when deterministic title similarity says it is too close.',
    '',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

function assessHeadlineSimilarityForDraft(params: {
  candidate: DraftCandidate
  recentCoverage: RecentCoverageItem[]
  acceptedDrafts: DraftCandidate[]
}): { violates: boolean; reason: string } {
  const assessment = assessHeadlineSimilarity({
    candidate: params.candidate.headline,
    recentTitles: params.recentCoverage.map((item) => item.headline),
    batchTitles: params.acceptedDrafts.map((item) => item.headline),
  })

  if (!assessment.tooSimilar) return { violates: false, reason: 'headline similarity accepted' }

  return {
    violates: true,
    reason: assessment.reason,
  }
}

const RENT_THEME_PATTERNS: RegExp[] = [
  /\brent(?:s|ed|ing|al)?\b/i,
  /\brent\s+(?:hike|hikes|control|increase|increases|protest|protests|price|prices)\b/i,
  /\bhousing\b/i,
  /\bhous(?:e|ing)\s+crisis\b/i,
  /\blandlord(?:s)?\b/i,
  /\bapartment(?:s)?\b/i,
  /\bwohn(?:ung|ungs)/i,
  /\bzwischenmiete\b/i,
  /\bwg\b/i,
  /\bairbnb\b/i,
  /\bpriced?\s+out\b/i,
  /\bmiete\b/i,
]

function textMatchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function isRentThemePitch(candidate: DraftCandidate): boolean {
  const text = [candidate.headline, candidate.subheadline ?? '', candidate.excerpt ?? '']
    .join(' ')
    .trim()
  if (!text) return false
  return textMatchesAnyPattern(text, RENT_THEME_PATTERNS)
}

function countRentThemeReferences(lines: string[]): number {
  let count = 0
  for (const line of lines) {
    if (!line.trim()) continue
    if (textMatchesAnyPattern(line, RENT_THEME_PATTERNS)) count += 1
  }
  return count
}

function buildRentThemeBiasInstruction(params: {
  slot: SlotConfig
  assignedTopic: string | null
  recentCoverage: RecentCoverageItem[]
  acceptedDrafts: DraftCandidate[]
}): string {
  const referenceTexts = [
    ...params.recentCoverage.map((item) => `${item.headline} ${item.excerpt}`.trim()),
    ...params.acceptedDrafts.map((item) => `${item.headline} ${item.excerpt ?? ''}`.trim()),
  ].filter((line) => line.length > 0)

  const rentThemeRecentCount = countRentThemeReferences(referenceTexts)
  const promptBiasThreshold = Number(process.env.DRAFT_RENT_THEME_PROMPT_BIAS_THRESHOLD ?? 2)
  const assignedTopicIsRentTheme =
    typeof params.assignedTopic === 'string' &&
    params.assignedTopic.trim().length > 0 &&
    textMatchesAnyPattern(params.assignedTopic, RENT_THEME_PATTERNS)

  if (!Number.isFinite(promptBiasThreshold) || promptBiasThreshold < 0) return ''
  if (rentThemeRecentCount <= promptBiasThreshold) return ''

  if (params.slot.forceStartup) {
    if (assignedTopicIsRentTheme) {
      return `Editorial steering: recent coverage is saturated with rent/housing angles (${rentThemeRecentCount} recent references). Because this slot/topic may still touch housing, do NOT use generic rent pain as the main joke. Find a different contradiction inside startup/gentrification (status signaling, co-working rituals, VC theater, expat behavior, wellness-capitalism, workplace hypocrisy, English-language bubble).`
    }
    return `Editorial steering: recent coverage is saturated with rent/housing angles (${rentThemeRecentCount} recent references). For this startup/gentrification slot, avoid rent/housing entirely and center a different contradiction: co-working culture, VC/pitch-night theater, startup workplace behavior, expat status games, wellness-capitalism, or language/culture displacement rituals.`
  }

  if (assignedTopicIsRentTheme) {
    return `Editorial steering: rent/housing has been overused recently (${rentThemeRecentCount} recent references). If this topic mentions housing, avoid making rent prices/landlords/apartment hunting the central punchline; choose a less-used contradiction within the same story.`
  }

  return `Editorial steering: rent/housing has been overused recently (${rentThemeRecentCount} recent references). Do NOT pivot this pitch toward rent, landlords, apartment hunting, or generic housing crisis jokes.`
}

export async function generateDraftCandidate(params: {
  slot: SlotConfig
  topicSummary: string
  rssTopics?: RssTopic[]
  recentCoverage: RecentCoverageItem[]
  blacklistSummary: string
  acceptedDrafts: DraftCandidate[]
  forbiddenSourceTopics?: string[]
  previousAttempt?: {
    draft: DraftCandidate
    rejectionReason: string
  }
  editorDirection?: string
  includeBerlinThemes?: boolean
  useRandomModes?: boolean
  strictTopicFocus?: boolean
}): Promise<{ draft: DraftCandidate; sourceRssTopic: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY')

  const modelName =
    process.env.OPENAI_DRAFT_MODEL ??
    process.env.OPENAI_ANALYSIS_MODEL ??
    process.env.OPENAI_MODEL ??
    'gpt-4o-mini'

  const includeBerlinThemes = params.includeBerlinThemes !== false
  const useRandomModes = params.useRandomModes !== false
  const strictTopicFocus = params.strictTopicFocus === true

  const selectedTopic = pickTopicForSlot(
    params.slot,
    params.topicSummary,
    params.forbiddenSourceTopics ?? [],
    useRandomModes,
  )
  const topic = selectedTopic?.value ?? null
  const selectedRssContext =
    selectedTopic?.source === 'rss'
      ? (params.rssTopics ?? []).find(
          (candidate) =>
            normalizeTopicIdentity(candidate.title) === normalizeTopicIdentity(topic ?? ''),
        )
      : undefined
  const resolvedRssContext = selectedRssContext
    ? await resolveRssTopicContext(selectedRssContext)
    : undefined
  const rssGroundingSection = resolvedRssContext ? buildRssGroundingPrompt(resolvedRssContext) : ''
  const llm = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 1,
  })

  const recentLines = buildReferenceLines(params.recentCoverage)
  const acceptedBatchLines = params.acceptedDrafts
    .slice(0, 20)
    .map((d, i) => `${i + 1}. ${d.headline}${d.excerpt ? ` — ${d.excerpt}` : ''}`)
    .join('\n')
  const headlineSimilarityGuardSection = buildHeadlineSimilarityGuardSection({
    recentCoverage: params.recentCoverage,
    acceptedDrafts: params.acceptedDrafts,
  })
  const rentThemeBiasInstruction = buildRentThemeBiasInstruction({
    slot: params.slot,
    assignedTopic: topic,
    recentCoverage: params.recentCoverage,
    acceptedDrafts: params.acceptedDrafts,
  })
  const editorDirection = (params.editorDirection ?? params.slot.editorDirection)?.trim()
  const hasEditorDirection = typeof editorDirection === 'string' && editorDirection.length > 0
  const previousAttemptSection = params.previousAttempt
    ? [
        'CORRECT THE PREVIOUS REJECTION:',
        `Evaluator feedback: ${params.previousAttempt.rejectionReason.slice(0, 500)}`,
        `Previous rejected pitch: ${JSON.stringify(params.previousAttempt.draft)}`,
        '- Produce a new pitch for the currently assigned topic that directly corrects the evaluator feedback.',
        '- Do not copy the rejected wording or merely add a dirty word; repair the underlying comedic mechanism.',
        '',
      ].join('\n')
    : ''

  // Only include the full, heavy HUMOR engine in the slot-level sample to vary tone.
  const includeHumorEngine = shouldIncludeHumorPerspectiveMethod(
    params.slot.useHumorPerspectiveMethod,
  )

  const systemPrompt = [
    includeBerlinThemes
      ? 'You are writing one satirical NEWSPAPER PITCH for The Wedding Times (Berlin satire).'
      : 'You are writing one satirical NEWSPAPER PITCH for a satirical newspaper covering global current events.',
    HEADLINE_LANGUAGE_POLICY_PROMPT,
    'Output strict JSON only.',
    'Be original, topical, and mercilessly funny.',
    '',
    includeHumorEngine
      ? [
          'TOP PRIORITY: The humor engine below is the main rule. All other guidance is secondary.',
          'If anything conflicts, follow the humor engine.',
          '',
          HUMOR_PERSPECTIVE_METHOD,
          '',
        ].join('\n')
      : '',
    ACID_HUMOR_REQUIREMENTS,
    '',
    DRAFT_STRONG_HEADLINE_STYLE_REQUIREMENTS,
    '',
    ANTI_META_COMMENTARY_RULES,
    '',
    MICRO_DETAIL_FORMULA_GUARD,
    '',
    CRAZY_HEADLINE_REQUIREMENTS,
    '',
    CULTURAL_REFERENCE_HEADLINE_GUIDANCE,
    '',
    includeBerlinThemes ? WEDDING_REMINDER_SHORT : '',
  ].join('\n')

  const userPrompt = [
    'Write only a pitch, not the full article.',
    includeHumorEngine
      ? 'PASS/FAIL RULE: the pitch must center one under-noticed detail that reveals the opposite of the official narrative.'
      : 'QUALITY RULE: the pitch must have a specific satirical angle with concrete stakes and social bite.',
    'Return JSON schema:',
    '{ "headline": string, "subheadline": string|null, "excerpt": string|null }',
    '',
    HEADLINE_LANGUAGE_POLICY_PROMPT,
    '',
    `Mode: ${buildModeInstruction(params.slot, includeBerlinThemes)}`,
    topic ? `Assigned topic/news hook: ${topic}` : 'No fixed topic: choose a fresh one.',
    rssGroundingSection,
    '',
    'ABSOLUTE: Avoid overlap with these already-covered stories:',
    recentLines || '- none',
    '',
    params.blacklistSummary.trim().length > 0
      ? ['Blacklist summary (off-limits):', params.blacklistSummary.slice(0, 2400), ''].join('\n')
      : '',
    acceptedBatchLines.length > 0
      ? ['Already accepted in this same batch (must differ):', acceptedBatchLines, ''].join('\n')
      : '',
    headlineSimilarityGuardSection,
    hasEditorDirection
      ? [
          'Editor revision request (apply while preserving originality and punch):',
          `- ${editorDirection?.slice(0, 700)}`,
          '',
        ].join('\n')
      : '',
    strictTopicFocus && topic
      ? [
          'STRICT TOPIC FOCUS (MANDATORY):',
          '- Headline must explicitly mention the key named entity from the assigned topic when available.',
          '- Subheadline or excerpt must make the same story immediately recognizable.',
          '',
        ].join('\n')
      : '',
    previousAttemptSection,
    'Rules:',
    DRAFT_STRONG_HEADLINE_STYLE_REQUIREMENTS,
    '',
    CRAZY_HEADLINE_REQUIREMENTS,
    CULTURAL_REFERENCE_HEADLINE_GUIDANCE,
    ...buildDraftPerspectiveRuleLines(includeHumorEngine),
    '- Do NOT use the exhausted micro-detail hook: tiny hidden object, exact mm/cm/Hz measurement, then scam reveal.',
    '- Avoid headlines shaped like "The [tiny thing] That..." or "How a [small measured thing]..." unless the story absolutely cannot work without it.',
    '- Prefer larger mechanisms: policy, staffing, paperwork, pricing, app settings, permits, queues, meetings, incentives, enforcement, social rituals.',
    '- Headline must be sharp and specific (not generic).',
    '- Subheadline and excerpt must be complete standalone sentence(s), not cropped fragments.',
    '- Subheadline and excerpt must read like a newspaper deck or summary, not writer notes.',
    ANTI_META_COMMENTARY_RULES,
    '- Never end subheadline or excerpt with a comma, dash, connector word, dependent clause, or visibly unfinished thought.',
    '- Excerpt should preview a concrete absurd premise in 1-2 sentences.',
    '- Do not reuse the same core premise as anything listed above.',
    !params.slot.forceStartup && !params.slot.forceDrugsTechno && !params.slot.forceRss
      ? '- For non-startup slots: prefer bureaucracy, administrative slowness, public rudeness, street filth, bad weather, and health-system dysfunction. Do not default to startup/gentrification unless the angle is clearly fresher than these themes.'
      : '',
    params.slot.forceStartup
      ? '- In startup/gentrification mode: prefer co-working, venture capital, workplace theater, expat behavior, or wellness-capitalism angles before rent/housing. Rent is allowed only if the premise is unusually specific and not a default Berlin-housing joke.'
      : '',
    rentThemeBiasInstruction,
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])
  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  const jsonText = extractFirstJsonObject(text)
  const parsed = JSON.parse(jsonText) as unknown
  const rawCandidate = RawDraftCandidateSchema.parse(parsed)
  const normalized = normalizeDraft({
    headline: rawCandidate.headline,
    subheadline: rawCandidate.subheadline ?? null,
    excerpt: rawCandidate.excerpt ?? null,
  })
  const validated = DraftCandidateSchema.parse(normalized)

  return {
    draft: {
      headline: validated.headline,
      subheadline: validated.subheadline ?? null,
      excerpt: validated.excerpt ?? null,
    },
    sourceRssTopic:
      selectedTopic && (selectedTopic.source === 'rss' || selectedTopic.source === 'hint')
        ? selectedTopic.value
        : null,
  }
}

async function evaluateDraftTone(
  candidate: DraftCandidate,
): Promise<z.infer<typeof DraftToneSchema>> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY')

  const modelName = process.env.OPENAI_DRAFT_EVAL_MODEL?.trim() || 'gpt-4o-mini'
  const llm = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0,
  })

  const systemPrompt = [
    'You are a satire pitch evaluator.',
    'You are evaluating a three-field pitch, not a finished article.',
    'Output strict JSON only.',
    'Score if the pitch is funny, merciless, and specific.',
    ANTI_META_COMMENTARY_RULES,
    'The headline must pass at least one strong style lane: a recognizable conceptual sexual double meaning OR a genuinely surreal/pataphysical mechanism.',
    'For the sexual lane, a dirty word or disconnected suggestive phrase does not count; the headline, subheadline, and excerpt must connect through one coherent conceptual mechanism, power dynamic, and social accusation.',
    'For the surreal/pataphysical lane, an impossible rule, object, institution, or physical fact must reorganize the story’s real-world logic and social accusation while everyone treats it as ordinary procedure.',
    'Random odd nouns, merely weird wording, generic absurdity, dream imagery, or announcing that something is surreal do not count.',
    'A pitch may pass either lane. Reward one that achieves both without obscuring the actual story.',
    'Judge only whether the pitch establishes that governing concept clearly enough for the full article to develop it.',
    'Do not demand callbacks, an ending, or a full article arc from a three-field pitch.',
    'Subtle bodily, submission, appetite, penetration, exposure, restraint, servicing, or intimacy metaphors can pass when their literal and sexual readings reinforce the same power dynamic; explicit sex words are not required.',
    'Language policy has already been validated by a separate deterministic gate. Do not score or reject language.',
  ].join('\n')
  const userPrompt = [
    'Evaluate this draft pitch JSON:',
    JSON.stringify(candidate),
    '',
    'JSON schema:',
    '{ "funScore": number, "mercilessScore": number, "specificityScore": number, "conceptualInnuendoPass": boolean, "surrealPataphysicsPass": boolean, "metaCommentaryPass": boolean, "pass": boolean, "reason": string }',
    '',
    'Set conceptualInnuendoPass=false when the headline lacks the conceptual sexual double meaning or merely adds a dirty word or suggestive phrase.',
    'Set surrealPataphysicsPass=false when the headline lacks a governing impossible mechanism or merely uses random odd, weird, dreamlike, or absurd wording.',
    'Set metaCommentaryPass=false if any field contains meta-commentary, breaks the fourth wall, labels this current pitch as satire/comedy, explains its joke, premise, angle, genre, or intent, or directs how readers should react to it.',
    'Set pass=true only when either conceptualInnuendoPass or surrealPataphysicsPass is true, metaCommentaryPass is true, all scores are >= 7, the angle is not bland, the pitch has real bite, and the tone is not too clean or polite.',
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  const parsed = JSON.parse(extractFirstJsonObject(text)) as unknown
  const tone = DraftToneSchema.parse(parsed)
  return tone
}

export async function evaluateDraftCandidate(params: {
  candidate: DraftCandidate
  recentCoverage: RecentCoverageItem[]
  acceptedDrafts: DraftCandidate[]
}): Promise<DraftEvaluation> {
  const referenceTexts = [
    ...params.recentCoverage.map((item) => `${item.headline} ${item.excerpt}`.trim()),
    ...params.acceptedDrafts.map((item) => `${item.headline} ${item.excerpt ?? ''}`.trim()),
  ].filter((line) => line.length > 0)

  const fingerprint =
    `${params.candidate.headline} ${params.candidate.subheadline ?? ''} ${params.candidate.excerpt ?? ''}`.trim()
  const repetition = assessRecentCoverageOverlap({
    candidate: fingerprint,
    references: referenceTexts,
  })

  const headlineLanguage = assessHeadlineLanguage(params.candidate.headline)
  if (!headlineLanguage.passes) {
    return {
      accepted: false,
      safeForFallback: false,
      reason: headlineLanguage.reason,
      repetition,
      tone: {
        funScore: 1,
        mercilessScore: 1,
        specificityScore: 1,
        conceptualInnuendoPass: false,
        surrealPataphysicsPass: false,
        metaCommentaryPass: false,
        languagePass: false,
        englishShare: headlineLanguage.englishShare,
        germanUsageSummary: headlineLanguage.signals.join(', '),
        pass: false,
        reason: 'Tone evaluation skipped because headline language was rejected.',
      },
    }
  }

  const supportingTextLanguage = [params.candidate.subheadline, params.candidate.excerpt]
    .map((text) => assessSupportingTextLanguage(text))
    .find((assessment) => !assessment.passes)
  if (supportingTextLanguage) {
    return {
      accepted: false,
      safeForFallback: false,
      reason: supportingTextLanguage.reason,
      repetition,
      tone: {
        funScore: 1,
        mercilessScore: 1,
        specificityScore: 1,
        conceptualInnuendoPass: false,
        surrealPataphysicsPass: false,
        metaCommentaryPass: false,
        languagePass: false,
        englishShare: headlineLanguage.englishShare,
        germanUsageSummary: supportingTextLanguage.signals.join(', '),
        pass: false,
        reason: 'Tone evaluation skipped because supporting text language was rejected.',
      },
    }
  }

  const explicitMetaField = (
    [
      ['headline', params.candidate.headline],
      ['subheadline', params.candidate.subheadline],
      ['excerpt', params.candidate.excerpt],
    ] as const
  ).find(([, value]) => typeof value === 'string' && hasMetaSummaryVoice(value))?.[0]

  if (explicitMetaField) {
    return {
      accepted: false,
      safeForFallback: false,
      reason: `meta-commentary: ${explicitMetaField} contains explicit self-referential commentary`,
      repetition,
      tone: {
        funScore: 1,
        mercilessScore: 1,
        specificityScore: 1,
        conceptualInnuendoPass: false,
        surrealPataphysicsPass: false,
        metaCommentaryPass: false,
        languagePass: true,
        englishShare: headlineLanguage.englishShare,
        germanUsageSummary: 'Deterministic language gate passed.',
        pass: false,
        reason: 'Tone evaluation skipped because explicit meta-commentary was rejected.',
      },
    }
  }

  const headlineSimilarity = assessHeadlineSimilarityForDraft({
    candidate: params.candidate,
    recentCoverage: params.recentCoverage,
    acceptedDrafts: params.acceptedDrafts,
  })

  if (headlineSimilarity.violates) {
    return {
      accepted: false,
      safeForFallback: false,
      reason: headlineSimilarity.reason,
      repetition,
      tone: {
        funScore: 1,
        mercilessScore: 1,
        specificityScore: 1,
        conceptualInnuendoPass: false,
        surrealPataphysicsPass: false,
        metaCommentaryPass: false,
        languagePass: true,
        englishShare: headlineLanguage.englishShare,
        germanUsageSummary: headlineLanguage.signals.join(', '),
        pass: false,
        reason: 'Tone evaluation skipped because headline similarity was rejected.',
      },
    }
  }

  const headlineTaste = assessHeadlineTaste(params.candidate.headline)
  if (!headlineTaste.passes) {
    return {
      accepted: false,
      safeForFallback: false,
      reason: headlineTaste.reason,
      repetition,
      tone: {
        funScore: 1,
        mercilessScore: 1,
        specificityScore: 1,
        conceptualInnuendoPass: false,
        surrealPataphysicsPass: false,
        metaCommentaryPass: false,
        languagePass: true,
        englishShare: headlineLanguage.englishShare,
        germanUsageSummary: headlineLanguage.signals.join(', '),
        pass: false,
        reason: 'Tone evaluation skipped because headline taste was rejected.',
      },
    }
  }

  let tone: DraftEvaluation['tone']
  try {
    const semanticTone = await evaluateDraftTone(params.candidate)
    tone = {
      ...semanticTone,
      languagePass: true,
      englishShare: headlineLanguage.englishShare,
      germanUsageSummary: 'Deterministic language gate passed.',
    }
  } catch (error) {
    console.warn(
      '[DRAFT-PIPELINE] Tone evaluator failed',
      error instanceof Error ? error.message : String(error),
    )
    tone = {
      funScore: 7,
      mercilessScore: 7,
      specificityScore: 7,
      conceptualInnuendoPass: false,
      surrealPataphysicsPass: false,
      metaCommentaryPass: true,
      languagePass: true,
      englishShare: headlineLanguage.englishShare,
      germanUsageSummary: 'Deterministic language gate passed; evaluator unavailable.',
      pass: false,
      reason:
        'Tone evaluator unavailable; rejected because mandatory semantic requirements could not be verified.',
    }
  }

  const minFun = Number(process.env.DRAFT_MIN_FUN_SCORE ?? 7)
  const minMerciless = Number(process.env.DRAFT_MIN_MERCILESS_SCORE ?? 7)
  const minSpecificity = Number(process.env.DRAFT_MIN_SPECIFICITY_SCORE ?? 6)

  if (!tone.languagePass) {
    return {
      accepted: false,
      safeForFallback: false,
      reason: `headline-language: ${tone.germanUsageSummary || tone.reason}`,
      repetition,
      tone,
    }
  }

  const tonePass =
    tone.pass &&
    (tone.conceptualInnuendoPass || tone.surrealPataphysicsPass) &&
    tone.metaCommentaryPass &&
    tone.funScore >= minFun &&
    tone.mercilessScore >= minMerciless &&
    tone.specificityScore >= minSpecificity

  if (repetition.overlaps) {
    return {
      accepted: false,
      safeForFallback: false,
      reason: `repetition: ${repetition.reason}`,
      repetition,
      tone,
    }
  }

  const rentThemeRecentCount = countRentThemeReferences(referenceTexts)
  // Hard reject is opt-in; prompt steering is the default mechanism to reduce retries.
  const rentThemeMaxRecent = Number(process.env.DRAFT_RENT_THEME_MAX_RECENT ?? -1)
  const candidateIsRentTheme = isRentThemePitch(params.candidate)

  if (
    candidateIsRentTheme &&
    Number.isFinite(rentThemeMaxRecent) &&
    rentThemeMaxRecent >= 0 &&
    rentThemeRecentCount > Math.max(0, rentThemeMaxRecent)
  ) {
    return {
      accepted: false,
      safeForFallback: false,
      reason: `theme-bias: rent/housing is overrepresented recently (${rentThemeRecentCount} recent references > limit ${Math.max(0, rentThemeMaxRecent)})`,
      repetition,
      tone,
    }
  }

  if (!tonePass) {
    return {
      accepted: false,
      safeForFallback: tone.metaCommentaryPass,
      reason: `tone: ${tone.reason}`,
      repetition,
      tone,
    }
  }

  return {
    accepted: true,
    safeForFallback: true,
    reason: 'accepted',
    repetition,
    tone,
  }
}
