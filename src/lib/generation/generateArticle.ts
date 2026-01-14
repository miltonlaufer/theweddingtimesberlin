import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'

/******************* TYPES ***********************/

export interface GeneratorCategoryOption {
  slug: string
  name: string
}

export interface GeneratorAuthorOption {
  slug: string
  name: string
  title?: string
  bio?: string
}

export interface GenerateArticleInput {
  categories: GeneratorCategoryOption[]
  authors: GeneratorAuthorOption[]
  topicSummary: string
  includeTopics: boolean
  recentArticleTitles: string[] // Titles of recent articles to avoid repeating
}

export const GeneratedArticleSchema = z.object({
  headline: z.string().min(10).max(140),
  subheadline: z.string().max(220).optional().nullable(),
  excerpt: z.string().max(300).optional().nullable(),
  bodyMarkdown: z.string().min(200),
  categorySlug: z.string().min(1),
  authorSlug: z.string().min(1),
  layout: z.enum(['standard', 'wide', 'opinion']),
  isFeatured: z.boolean(),
  isHeadline: z.boolean(),
  imageCaption: z.string().max(160).optional().nullable(),
  imagePrompt: z.string().max(600).optional().nullable(),
})

export type GeneratedArticle = z.infer<typeof GeneratedArticleSchema>

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
      runId: 'llm-schema',
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

function safeStringList(items: Array<{ slug: string; name: string; title?: string; bio?: string }>): string {
  return items
    .map((i) => {
      const title = i.title ? ` — ${i.title}` : ''
      const bio = i.bio ? ` — ${i.bio}` : ''
      // Keep it compact for tokens; bios can be long.
      const trimmedBio = bio.length > 240 ? `${bio.slice(0, 240)}…` : bio
      return `- ${i.slug}: ${i.name}${title}${trimmedBio}`
    })
    .join('\n')
}

/******************* VALIDATION / REPAIR ***********************/

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return 'unknown error'
  }
}

function looksNonEnglish(text: string): boolean {
  // Heuristic: detect common German function words and umlauts.
  const lower = text.toLowerCase()
  const germanMarkers = [' der ', ' die ', ' das ', ' und ', ' nicht ', ' ist ', ' mit ', ' für ', ' im ', ' auf ']
  const hasMarkers = germanMarkers.some((m) => lower.includes(m))
  const hasUmlaut = /[äöüß]/i.test(text)
  return hasMarkers || hasUmlaut
}

async function translateToEnglish(args: {
  bad: GeneratedArticle
  categories: GeneratorCategoryOption[]
  authors: GeneratorAuthorOption[]
}): Promise<GeneratedArticle> {
  // Hypotheses:
  // E: model sometimes outputs German despite instructions
  // F: deterministic translate pass fixes to English without breaking schema

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const translateModelName = process.env.OPENAI_TRANSLATE_MODEL ?? process.env.OPENAI_REPAIR_MODEL ?? 'gpt-4o-mini'

  const llm = new ChatOpenAI({
    apiKey,
    model: translateModelName,
    temperature: 0,
  })

  log('F', 'src/lib/generation/generateArticle.ts:121', 'translate_invoke', {
    translateModelName,
    headlineLen: args.bad.headline.length,
  })

  const categoriesList = safeStringList(args.categories)
  const authorsList = safeStringList(args.authors)

  const systemPrompt = [
    'You are a translation-and-structure tool.',
    'Translate the provided article fields to US English while preserving satire tone.',
    'Output MUST be strict JSON only, no markdown fences, no extra text.',
    'Rules:',
    '- Keep categorySlug and authorSlug valid: choose from allowed options.',
    '- Keep the same JSON schema and field types.',
    '- Ensure bodyMarkdown is English markdown (no code blocks).',
  ].join('\n')

  const userPrompt = [
    'Allowed categorySlug options:',
    categoriesList,
    '',
    'Allowed authorSlug options:',
    authorsList,
    '',
    'Translate this JSON to US English (preserve structure, keep slugs valid):',
    JSON.stringify(args.bad),
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  const jsonText = extractFirstJsonObject(text)
  const parsed = JSON.parse(jsonText) as unknown
  const validated = GeneratedArticleSchema.parse(parsed)

  log('F', 'src/lib/generation/generateArticle.ts:167', 'translate_success', {
    headlineLen: validated.headline.length,
  })

  return validated
}

async function repairToSchema(args: {
  badOutput: string
  categories: GeneratorCategoryOption[]
  authors: GeneratorAuthorOption[]
}): Promise<GeneratedArticle> {
  // Hypotheses:
  // A: primary model returns non-JSON or partial JSON
  // B: JSON parses but fails zod schema (wrong types/keys)
  // C: invalid slugs not in allowed options
  // D: repair model fixes to valid JSON deterministically

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const repairModelName = process.env.OPENAI_REPAIR_MODEL ?? 'gpt-4o-mini'

  const llm = new ChatOpenAI({
    apiKey,
    model: repairModelName,
    temperature: 0,
  })

  const categoriesList = safeStringList(args.categories)
  const authorsList = safeStringList(args.authors)

  log('D', 'src/lib/generation/generateArticle.ts:106', 'repair_invoke', {
    repairModelName,
    badOutputLen: args.badOutput.length,
  })

  const systemPrompt = [
    'You are a JSON repair tool.',
    'You will be given malformed or schema-invalid content produced by another model.',
    'Your job is to output STRICT JSON that matches the required schema.',
    'Rules:',
    '- Output JSON only (no markdown fences, no extra commentary).',
    '- All text fields must be in US English.',
    '- Ensure categorySlug is one of the allowed categorySlug options.',
    '- Ensure authorSlug is one of the allowed authorSlug options.',
    '- Ensure bodyMarkdown is a single markdown string (no code blocks).',
  ].join('\n')

  const userPrompt = [
    'Allowed categorySlug options:',
    categoriesList,
    '',
    'Allowed authorSlug options:',
    authorsList,
    '',
    'Required JSON schema:',
    '{',
    '  "headline": string,',
    '  "subheadline": string|null,',
    '  "excerpt": string|null,  // <= 300 chars',
    '  "bodyMarkdown": string,  // markdown with headings/paragraphs/lists; no code blocks',
    '  "categorySlug": string,',
    '  "authorSlug": string,',
    '  "layout": "standard"|"wide"|"opinion",',
    '  "isFeatured": boolean,',
    '  "isHeadline": boolean,',
    '  "imageCaption": string|null,',
    '  "imagePrompt": string|null',
    '}',
    '',
    'Bad output to repair:',
    args.badOutput,
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  const jsonText = extractFirstJsonObject(text)
  const parsed = JSON.parse(jsonText) as unknown
  const validated = GeneratedArticleSchema.parse(parsed)

  log('D', 'src/lib/generation/generateArticle.ts:161', 'repair_success', {
    headlineLen: validated.headline.length,
    hasImagePrompt: Boolean(validated.imagePrompt),
  })

  return validated
}

/******************* MAIN ***********************/

export async function generateArticle(input: GenerateArticleInput): Promise<GeneratedArticle> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const modelName = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

  const llm = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0.9,
  })

  // Randomly pick a topic focus to force variety (aligned with site categories)
  const topicFocuses = [
    // Bureaucracy
    'Bürgeramt nightmares, appointment systems, or German paperwork hell',
    'Berlin bureaucracy, forms in triplicate, or civil servant attitudes',
    // Leopoldplatz
    'Leopoldplatz happenings, the fountain crowd, or Wedding central life',
    'Leopoldplatz characters, street vendors, or the morning drunks',
    // Nightlife
    'Berlin techno clubs, Berghain door policy, or nightlife culture',
    'after-hours clubs, sunrise sessions, or the walk of shame home',
    // Crime
    'bike theft epidemic, stolen e-scooters, or neighborhood watch drama',
    'petty crime in Berlin, suspicious activity, or police blotter absurdity',
    'Späti robberies, U-Bahn pickpockets, or street dealer turf wars',
    // Techno
    'Berlin techno scene, DJ drama, or warehouse rave culture',
    'Berghain rejection stories, club outfit disasters, or bouncer psychology',
    // Doener & Drinks
    'döner kebab culture, späti life, or Berlin food scene',
    'best döner debates, kebab rankings, or late-night munchies',
    // Kiez News
    'local neighborhood drama, kiez gossip, or community board meetings',
    'BVG transit delays, U-Bahn drama, or S-Bahn chaos',
    'new hipster café openings, shop closures, or rent hikes on your block',
    // Gentrification
    'gentrification battles, rent protests, or neighborhood changes',
    'expat invasion, English menus everywhere, or "authentic" Berlin debates',
    'startup culture, co-working spaces, or tech bros pricing out locals',
    // General Berlin satire
    'tourist invasions in Kreuzberg, Mitte, or Friedrichshain',
    'expat life struggles, language barriers, or Anmeldung nightmares',
    'Berlin vs Munich rivalry or German regional stereotypes',
    'climate protests, Last Generation activists, or environmental drama',
    'art galleries, street art, or Berlin creative scene',
    'German workplace culture, sick days, or office politics',
    'dating in Berlin, Tinder culture, or relationship chaos',
    'Berlin drug culture, club bathroom discoveries, or ketamine brunch',
    'Berlin decadence, after-parties that last days, or hedonistic lifestyle',
    'Berlin filth, lack of street cleaning, overflowing trash, or rat sightings',
    'Görlitzer Park shenanigans, dealer diplomacy, or park culture',
  ]
  const randomFocus = topicFocuses[Math.floor(Math.random() * topicFocuses.length)]

  const recentTitlesSection =
    input.recentArticleTitles.length > 0
      ? `\nCRITICAL: DO NOT write about these recent article topics (avoid repetition):\n${input.recentArticleTitles.map((title, idx) => `${idx + 1}. ${title}`).join('\n')}\n\nYou must write about a DIFFERENT topic/subject matter.`
      : ''

  const systemPrompt = [
    'You are a satire writer for "The Wedding Times", a fictional satirical newspaper covering Berlin.',
    'Language: write everything in US English (no German, no other languages).',
    'Tone: news-like, witty, sharp, absurd, observational. Jokes should be intellectual meets indecent—clever wordplay and sophisticated humor with a subtle edge of risqué or slightly inappropriate content (think: Ricky Gervais meets intellectual dark humor, but avoid hate/harassment and stay within OpenAI safety guidelines).',
    `FOR THIS ARTICLE, focus on: ${randomFocus}`,
    recentTitlesSection,
    'CRITICAL: Pick a categorySlug that BEST matches your assigned topic focus above.',
    'Category mapping guide:',
    '- Drugs/ketamine/club bathroom → drugs',
    '- Techno/Berghain/DJ/warehouse rave → techno',
    '- Decadence/after-parties/hedonism → decadence',
    '- Filth/trash/cleaning/rats → filth',
    '- Bureaucracy/forms/appointments → bureaucracy',
    '- Leopoldplatz/fountain → leopoldplatz',
    '- Nightlife/clubs/parties → nightlife',
    '- Food/kebab/späti → food-drink',
    '- Crime/theft/police → crime',
    '- Local news/kiez/BVG → kiez',
    '- Rent/gentrification/expats → gentrification',
    '- Opinion/editorial → opinion',
    'DO NOT default to bureaucracy, nightlife, or opinion unless your topic truly matches.',
    'Important safety: do not use slurs; do not advocate harm; do not target protected groups with hateful content.',
    'Output MUST be strict JSON only, no markdown fences, no extra text.',
  ].join('\n')

  const categoriesList = safeStringList(input.categories)
  const authorsList = safeStringList(input.authors)

  const topicsSection =
    input.includeTopics && input.topicSummary.trim().length > 0
      ? `Current real-world topics (optional inspiration):\n${input.topicSummary}\n`
      : 'No external topics provided. Invent plausible current topics yourself.\n'

  const userPrompt = [
    topicsSection,
    'Important: ALL text fields must be written in US English.',
    'Choose exactly one categorySlug from the list below, and exactly one authorSlug from the list below.',
    'Return an article that could plausibly run on the front page of a satirical local paper.',
    '',
    'categorySlug options:',
    categoriesList,
    '',
    'authorSlug options:',
    authorsList,
    '',
    'JSON schema:',
    '{',
    '  "headline": string,',
    '  "subheadline": string|null,',
    '  "excerpt": string|null,  // <= 300 chars',
    '  "bodyMarkdown": string,  // markdown with headings/paragraphs/lists; no code blocks',
    '  "categorySlug": string,',
    '  "authorSlug": string,',
    '  "layout": "standard"|"wide"|"opinion",',
    '  "isFeatured": boolean,',
    '  "isHeadline": boolean,',
    '  "imageCaption": string|null,',
    '  "imagePrompt": string|null  // prompt for an illustrative photo-like image, no text overlays',
    '}',
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)

  log('A', 'src/lib/generation/generateArticle.ts:239', 'primary_response_received', {
    modelName,
    contentLen: text.length,
    includeTopics: input.includeTopics,
  })

  try {
    const jsonText = extractFirstJsonObject(text)
    const parsed = JSON.parse(jsonText) as unknown
    const validated = GeneratedArticleSchema.parse(parsed)
    log('B', 'src/lib/generation/generateArticle.ts:250', 'primary_validation_success', {
      headlineLen: validated.headline.length,
      hasImagePrompt: Boolean(validated.imagePrompt),
    })
    const langSample = `${validated.headline}\n${validated.subheadline ?? ''}\n${validated.bodyMarkdown}`.slice(0, 1200)
    const nonEnglish = looksNonEnglish(langSample)
    log('E', 'src/lib/generation/generateArticle.ts:258', 'language_check', { nonEnglish })

    if (nonEnglish) {
      return await translateToEnglish({
        bad: validated,
        categories: input.categories,
        authors: input.authors,
      })
    }

    return validated
  } catch (err) {
    log('B', 'src/lib/generation/generateArticle.ts:258', 'primary_validation_failed', {
      error: safeErrorMessage(err),
    })
    // Fallback: deterministic repair using cheaper model
    return await repairToSchema({
      badOutput: text,
      categories: input.categories,
      authors: input.authors,
    })
  }
}

