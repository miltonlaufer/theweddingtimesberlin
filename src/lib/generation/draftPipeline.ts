import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import { normalizeExcerptForStorage } from '@/lib/text/excerptQuality'
import {
  assessRecentCoverageOverlap,
  HUMOR_PERSPECTIVE_METHOD,
  WEDDING_REMINDER_SHORT,
} from '@/lib/generation/generateArticle'
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
  pass: z.boolean(),
  reason: z.string().max(300),
})

function extractFirstJsonObject(text: string): string {
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model did not return a JSON object')
  }
  return text.slice(firstBrace, lastBrace + 1)
}

function toTopicLines(topicSummary: string): string[] {
  return topicSummary
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function stripTopicSource(line: string): string {
  const withoutBullet = line.replace(/^-+\s*/, '')
  const sourceTagged = withoutBullet.match(/^\[[^\]]+\]\s*(.+)$/)
  if (sourceTagged?.[1]) return sourceTagged[1].trim()
  return withoutBullet.trim()
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
): string | null {
  const topicLines = toTopicLines(topicSummary)
    .map(stripTopicSource)
    .filter((line) => line.length > 0)
  const forbidden = new Set(
    forbiddenSourceTopics.map(normalizeTopicIdentity).filter((line) => line.length > 0),
  )
  const allowedTopics = topicLines.filter((line) => !forbidden.has(normalizeTopicIdentity(line)))
  const allowReuseWhenExhausted =
    (process.env.DRAFT_ALLOW_RSS_TOPIC_REUSE_WHEN_EXHAUSTED ?? 'false') === 'true'

  if (topicLines.length === 0) return null
  if (slot.forceRss) {
    if (allowedTopics.length > 0) {
      return allowedTopics[Math.floor(Math.random() * allowedTopics.length)] ?? null
    }
    return allowReuseWhenExhausted
      ? (topicLines[Math.floor(Math.random() * topicLines.length)] ?? null)
      : null
  }
  if (!slot.includeTopics) return null
  if (allowedTopics.length > 0) {
    return allowedTopics[Math.floor(Math.random() * allowedTopics.length)] ?? null
  }
  return allowReuseWhenExhausted
    ? (topicLines[Math.floor(Math.random() * topicLines.length)] ?? null)
    : null
}

function buildModeInstruction(slot: SlotConfig): string {
  if (slot.forceOpinion) {
    return 'This pitch must be an opinion/editorial angle with strong, direct point of view.'
  }
  if (slot.forceDrugsTechno) {
    return 'This pitch must center Berlin drugs/techno/nightlife culture.'
  }
  if (slot.forceStartup) {
    return 'This pitch must center startup culture, gentrification dynamics, expat/status signaling, co-working culture, or wellness-capitalism themes. Avoid defaulting to rent/housing as the main punchline unless the angle is unusually specific and fresh.'
  }
  if (slot.forceRss) {
    return 'This pitch must clearly satirize the assigned current-news topic.'
  }
  return 'Pick a fresh local Berlin satire angle that avoids repetition.'
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
    subheadline: candidate.subheadline?.trim().slice(0, 220) || null,
    excerpt:
      typeof candidate.excerpt === 'string'
        ? normalizeExcerptForStorage(candidate.excerpt, 300) || null
        : null,
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
  recentCoverage: RecentCoverageItem[]
  blacklistSummary: string
  acceptedDrafts: DraftCandidate[]
  forbiddenSourceTopics?: string[]
}): Promise<{ draft: DraftCandidate; sourceRssTopic: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY')

  const modelName =
    process.env.OPENAI_DRAFT_MODEL ??
    process.env.OPENAI_ANALYSIS_MODEL ??
    process.env.OPENAI_MODEL ??
    'gpt-4o-mini'

  const topic = pickTopicForSlot(
    params.slot,
    params.topicSummary,
    params.forbiddenSourceTopics ?? [],
  )
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
  const rentThemeBiasInstruction = buildRentThemeBiasInstruction({
    slot: params.slot,
    assignedTopic: topic,
    recentCoverage: params.recentCoverage,
    acceptedDrafts: params.acceptedDrafts,
  })

  const systemPrompt = [
    'You are writing one satirical NEWSPAPER PITCH for The Wedding Times (Berlin satire).',
    'Output strict JSON only.',
    'Be original, topical, and mercilessly funny.',
    '',
    'TOP PRIORITY: The humor engine below is the main rule. All other guidance is secondary.',
    'If anything conflicts, follow the humor engine.',
    '',
    HUMOR_PERSPECTIVE_METHOD,
    '',
    WEDDING_REMINDER_SHORT,
  ].join('\n')

  const userPrompt = [
    'Write only a pitch, not the full article.',
    'PASS/FAIL RULE: the pitch must center one under-noticed detail that reveals the opposite of the official narrative.',
    'Return JSON schema:',
    '{ "headline": string, "subheadline": string|null, "excerpt": string|null }',
    '',
    `Mode: ${buildModeInstruction(params.slot)}`,
    topic ? `Assigned topic/news hook: ${topic}` : 'No fixed topic: choose a fresh one.',
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
    'Rules:',
    '- Main rule: find an under-noticed detail and make the contradiction the comedic core.',
    '- If the contradiction is weak or generic, reject and rethink the pitch angle.',
    '- Headline must be sharp and specific (not generic).',
    '- Excerpt should preview a concrete absurd premise in 1-2 sentences.',
    '- Do not reuse the same core premise as anything listed above.',
    '- Do NOT use the exact phrase "overlooked detail" in the headline, subheadline, or excerpt.',
    !params.slot.forceStartup && !params.slot.forceDrugsTechno && !params.slot.forceRss
      ? '- For non-startup slots: prefer bureaucracy, administrative slowness, public rudeness, street filth, bad weather, and health-system dysfunction. Do not default to startup/gentrification unless the angle is clearly fresher than these themes.'
      : '',
    params.slot.forceStartup
      ? '- In startup/gentrification mode: prefer co-working, venture capital, workplace theater, expat behavior, or wellness-capitalism angles before rent/housing. Rent is allowed only if the premise is unusually specific and not a default Berlin-housing joke.'
      : '',
    rentThemeBiasInstruction,
    '- US English only.',
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
    sourceRssTopic: topic,
  }
}

async function evaluateDraftTone(candidate: DraftCandidate): Promise<DraftEvaluation['tone']> {
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
    'Output strict JSON only.',
    'Score if the pitch is funny, merciless, and specific.',
  ].join('\n')
  const userPrompt = [
    'Evaluate this draft pitch JSON:',
    JSON.stringify(candidate),
    '',
    'JSON schema:',
    '{ "funScore": number, "mercilessScore": number, "specificityScore": number, "pass": boolean, "reason": string }',
    '',
    'Set pass=true only when all scores are >= 6 and the angle is not bland.',
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

  let tone: DraftEvaluation['tone']
  try {
    tone = await evaluateDraftTone(params.candidate)
  } catch {
    tone = {
      funScore: 7,
      mercilessScore: 7,
      specificityScore: 7,
      pass: true,
      reason: 'Tone evaluator unavailable; accepted by fallback.',
    }
  }

  const minFun = Number(process.env.DRAFT_MIN_FUN_SCORE ?? 6)
  const minMerciless = Number(process.env.DRAFT_MIN_MERCILESS_SCORE ?? 6)
  const minSpecificity = Number(process.env.DRAFT_MIN_SPECIFICITY_SCORE ?? 6)

  const tonePass =
    tone.pass &&
    tone.funScore >= minFun &&
    tone.mercilessScore >= minMerciless &&
    tone.specificityScore >= minSpecificity

  if (repetition.overlaps) {
    return {
      accepted: false,
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
      reason: `theme-bias: rent/housing is overrepresented recently (${rentThemeRecentCount} recent references > limit ${Math.max(0, rentThemeMaxRecent)})`,
      repetition,
      tone,
    }
  }

  if (!tonePass) {
    return {
      accepted: false,
      reason: `tone: ${tone.reason}`,
      repetition,
      tone,
    }
  }

  return {
    accepted: true,
    reason: 'accepted',
    repetition,
    tone,
  }
}
