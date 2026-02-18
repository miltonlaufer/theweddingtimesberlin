import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import {
  assessRecentCoverageOverlap,
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
    return 'This pitch must center startup, gentrification, rent pressure, or wellness-capitalism themes.'
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
    excerpt: candidate.excerpt?.trim().slice(0, 300) || null,
  }
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

  const systemPrompt = [
    'You are writing one satirical NEWSPAPER PITCH for The Wedding Times (Berlin satire).',
    'Output strict JSON only.',
    'Be original, topical, and mercilessly funny.',
    '',
    WEDDING_REMINDER_SHORT,
  ].join('\n')

  const userPrompt = [
    'Write only a pitch, not the full article.',
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
    '- Headline must be sharp and specific (not generic).',
    '- Excerpt should preview a concrete absurd premise in 1-2 sentences.',
    '- Do not reuse the same core premise as anything listed above.',
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
