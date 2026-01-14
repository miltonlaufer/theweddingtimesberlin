import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'

/******************* TYPES ***********************/

export const GeneratedAuthorSchema = z.object({
  name: z.string().min(3).max(60),
  slug: z.string().min(3).max(60),
  title: z.string().min(3).max(80),
  bio: z.string().min(40).max(400),
})

export type GeneratedAuthor = z.infer<typeof GeneratedAuthorSchema>

export const GeneratedAuthorsSchema = z.object({
  authors: z.array(GeneratedAuthorSchema).min(1).max(10),
})

export type GeneratedAuthors = z.infer<typeof GeneratedAuthorsSchema>

/******************* LOGGING ***********************/

const LOG_ENDPOINT =
  'http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c'

function log(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'author-gen',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion agent log
}

/******************* HELPERS ***********************/

function extractFirstJsonObject(text: string): string {
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model did not return a JSON object')
  }
  return text.slice(firstBrace, lastBrace + 1)
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return 'unknown error'
  }
}

/******************* MAIN ***********************/

export async function generateAuthors(args: { count: number }): Promise<GeneratedAuthor[]> {
  // Hypotheses:
  // A: primary model returns non-JSON or schema-invalid author list
  // B: repair model fixes deterministically

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY')

  const modelName = process.env.OPENAI_AUTHOR_MODEL ?? 'gpt-4o-mini'
  const repairModelName = process.env.OPENAI_REPAIR_MODEL ?? 'gpt-4o-mini'

  const primary = new ChatOpenAI({ apiKey, model: modelName, temperature: 0.8 })
  const repair = new ChatOpenAI({ apiKey, model: repairModelName, temperature: 0 })

  const systemPrompt = [
    'You create fictional author personas for a satirical Berlin neighborhood newspaper called The Wedding Times.',
    'Tone: witty, sharp, absurd, but do not use slurs or hateful content.',
    'Return STRICT JSON only.',
  ].join('\n')

  const userPrompt = [
    `Create ${Math.max(1, Math.min(args.count, 10))} distinct author personas.`,
    'Make them Berlin/Wedding-adjacent and varied (bureaucracy reporter, nightlife, culture, opinion, etc.).',
    'Each author must have: name, slug (kebab-case), title, bio.',
    'JSON schema:',
    '{ "authors": [ { "name": string, "slug": string, "title": string, "bio": string } ] }',
  ].join('\n')

  const raw = await primary.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  log('A', 'src/lib/generation/generateAuthors.ts:91', 'primary_response', { modelName, len: text.length })

  try {
    const jsonText = extractFirstJsonObject(text)
    const parsed = JSON.parse(jsonText) as unknown
    const validated = GeneratedAuthorsSchema.parse(parsed)
    return validated.authors.slice(0, args.count)
  } catch (err) {
    log('A', 'src/lib/generation/generateAuthors.ts:101', 'primary_failed', { error: safeErrorMessage(err) })

    const repairSystem = [
      'You are a JSON repair tool.',
      'Output STRICT JSON that matches the required schema. No extra text.',
    ].join('\n')

    const repairUser = [
      'Required JSON schema:',
      '{ "authors": [ { "name": string, "slug": string, "title": string, "bio": string } ] }',
      '',
      'Bad output to repair:',
      text,
    ].join('\n')

    const repaired = await repair.invoke([
      { role: 'system', content: repairSystem },
      { role: 'user', content: repairUser },
    ])

    const repairedText = typeof repaired.content === 'string' ? repaired.content : JSON.stringify(repaired.content)
    log('B', 'src/lib/generation/generateAuthors.ts:125', 'repair_response', { repairModelName, len: repairedText.length })

    const repairedJson = extractFirstJsonObject(repairedText)
    const repairedParsed = JSON.parse(repairedJson) as unknown
    const repairedValidated = GeneratedAuthorsSchema.parse(repairedParsed)
    log('B', 'src/lib/generation/generateAuthors.ts:132', 'repair_success', { count: repairedValidated.authors.length })
    return repairedValidated.authors.slice(0, args.count)
  }
}

