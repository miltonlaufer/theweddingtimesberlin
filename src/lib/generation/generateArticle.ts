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
  recentHeadlinePatterns?: string[] // Patterns like "Berlin [verb] [noun]" to avoid
}

export const GeneratedArticleSchema = z.object({
  headline: z.string().min(10).max(140),
  subheadline: z.string().max(220).optional().nullable(),
  excerpt: z.string().max(300).optional().nullable(),
  bodyMarkdown: z.string().min(200),
  categorySlug: z.string().min(1),
  authorSlug: z.string().min(1),
  // New author fields - if creating a new author, provide these
  newAuthorName: z.string().max(60).optional().nullable(),
  newAuthorTitle: z.string().max(100).optional().nullable(),
  newAuthorBio: z.string().max(500).optional().nullable(),
  layout: z.enum(['standard', 'wide', 'opinion']),
  isFeatured: z.boolean(),
  isHeadline: z.boolean(),
  imageCaption: z.string().max(160).optional().nullable(),
  imagePrompt: z.string().max(600).optional().nullable(),
})

export type GeneratedArticle = z.infer<typeof GeneratedArticleSchema>

/******************* HELPERS ***********************/

function extractFirstJsonObject(text: string): string {
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model did not return a JSON object')
  }
  return text.slice(firstBrace, lastBrace + 1)
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      const max = issue.code === 'too_big' && 'maximum' in issue ? ` (max ${issue.maximum})` : ''
      return `- ${path}: ${issue.message}${max}`
    })
    .join('\n')
}

function hasTooBigIssues(issues: z.ZodIssue[]): boolean {
  return issues.some((issue) => issue.code === 'too_big')
}

function describeTooBigIssues(issues: z.ZodIssue[]): string {
  return issues
    .filter((issue) => issue.code === 'too_big')
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      const max = 'maximum' in issue ? issue.maximum : 'unknown'
      return `- ${path}: must be <= ${max} characters`
    })
    .join('\n')
}

function safeStringList(
  items: Array<{ slug: string; name: string; title?: string; bio?: string }>,
): string {
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

export function extractHeadlinePatterns(titles: string[]): string[] {
  const patterns = new Set<string>()

  for (const title of titles) {
    // Extract patterns like "Berlin [verb] [noun]" or "Wedding [verb] [noun]"
    const berlinMatch = title.match(/^Berlin\s+(\w+)\s+(.+)$/i)
    if (berlinMatch) {
      patterns.add(`Berlin [verb] [noun]`)
      continue
    }

    const weddingMatch = title.match(/^Wedding\s+(\w+)\s+(.+)$/i)
    if (weddingMatch) {
      patterns.add(`Wedding [verb] [noun]`)
      continue
    }

    // Check for other common patterns
    if (title.match(/^[A-Z][a-z]+\s+(Introduces|Launches|Announces|Declares|Unveils)/i)) {
      patterns.add(`[Location] [Announcement verb] [noun]`)
    }

    // Question patterns
    if (title.match(/^(Why|How|What|When|Where|Is|Are|Do|Does|Did)\s+/i)) {
      patterns.add(`[Question word] [rest]`)
    }

    // "The [noun] of [location]" pattern
    if (title.match(/^The\s+\w+\s+of\s+/i)) {
      patterns.add(`The [noun] of [location]`)
    }

    // "[Location] [verb]s [noun]" pattern
    if (title.match(/^[A-Z][a-z]+\s+\w+s\s+/i)) {
      patterns.add(`[Location] [verb]s [noun]`)
    }

    // "[Number] [things]" pattern
    if (title.match(/^(The\s+)?\d+\s+/i)) {
      patterns.add(`[Number] [things]`)
    }

    // "[Something] is [something]" pattern
    if (title.match(/\s+is\s+(the|a|an)\s+/i)) {
      patterns.add(`[Something] is [something]`)
    }

    // "[Something] vs [Something]" pattern
    if (title.match(/\s+vs\s+/i)) {
      patterns.add(`[Something] vs [Something]`)
    }

    // "How [something] [verb]" pattern
    if (title.match(/^How\s+\w+\s+\w+/i)) {
      patterns.add(`How [something] [verb]`)
    }

    // "[Location]'s [something]" pattern
    if (title.match(/^[A-Z][a-z]+'s\s+/i)) {
      patterns.add(`[Location]'s [something]`)
    }
  }

  return Array.from(patterns)
}

/******************* VALIDATION / REPAIR ***********************/

function looksNonEnglish(text: string): boolean {
  // Heuristic: detect common German function words and umlauts.
  const lower = text.toLowerCase()
  const germanMarkers = [
    ' der ',
    ' die ',
    ' das ',
    ' und ',
    ' nicht ',
    ' ist ',
    ' mit ',
    ' für ',
    ' im ',
    ' auf ',
  ]
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

  const translateModelName =
    process.env.OPENAI_TRANSLATE_MODEL ?? process.env.OPENAI_REPAIR_MODEL ?? 'gpt-4o-mini'

  const llm = new ChatOpenAI({
    apiKey,
    model: translateModelName,
    temperature: 0,
  })

  const categoriesList = safeStringList(args.categories)
  const authorsList = safeStringList(args.authors)

  const systemPrompt = [
    'You are a translation-and-structure tool.',
    'Translate the provided article fields to US English while preserving satire tone.',
    'Output MUST be strict JSON only, no markdown fences, no extra text.',
    'Rules:',
    '- categorySlug can be existing OR new.',
    '- authorSlug can be existing OR new. If new, you MUST provide newAuthorName, newAuthorTitle, newAuthorBio.',
    '- If the input has a new authorSlug but is missing newAuthorName/Title/Bio, GENERATE them based on the slug.',
    '- Keep the same JSON schema and field types.',
    '- Ensure bodyMarkdown is English markdown (no code blocks).',
    '- Preserve and translate newAuthorName, newAuthorTitle, newAuthorBio if present.',
  ].join('\n')

  const userPrompt = [
    'Existing categorySlug options (or create new):',
    categoriesList,
    '',
    'Existing authorSlug options (or create new with required fields):',
    authorsList,
    '',
    'CRITICAL: If authorSlug is NOT in the existing list, you MUST provide newAuthorName, newAuthorTitle, AND newAuthorBio.',
    '',
    'Translate this JSON to US English (preserve structure, ensure new author fields if needed):',
    JSON.stringify(args.bad),
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  const jsonText = extractFirstJsonObject(text)
  const parsed = JSON.parse(jsonText) as unknown
  const validation = GeneratedArticleSchema.safeParse(parsed)
  if (!validation.success) {
    return await repairToSchema({
      badOutput: text,
      categories: args.categories,
      authors: args.authors,
      validationErrors: validation.error.issues,
    })
  }

  return validation.data
}

async function repairToSchema(args: {
  badOutput: string
  categories: GeneratorCategoryOption[]
  authors: GeneratorAuthorOption[]
  validationErrors?: z.ZodIssue[]
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

  const systemPrompt = [
    'You are a JSON repair tool.',
    'You will be given malformed or schema-invalid content produced by another model.',
    'Your job is to output STRICT JSON that matches the required schema.',
    'Rules:',
    '- Output JSON only (no markdown fences, no extra commentary).',
    '- All text fields must be in US English.',
    '- categorySlug can be an existing one OR a new category slug (lowercase, hyphens).',
    '- authorSlug can be an existing one OR a new author slug. If the authorSlug is NOT in the existing list, you MUST provide newAuthorName, newAuthorTitle, AND newAuthorBio.',
    '- If the input has a new authorSlug but is missing newAuthorName/newAuthorTitle/newAuthorBio, you MUST GENERATE them based on the slug and article context.',
    '- Ensure bodyMarkdown is a single markdown string (no code blocks).',
    '- Respect ALL max-length limits; rewrite text to fit without truncating mid-word.',
  ].join('\n')

  const validationErrorsSection =
    args.validationErrors && args.validationErrors.length > 0
      ? ['Validation errors to fix:', formatZodIssues(args.validationErrors), ''].join('\n')
      : ''

  const userPrompt = [
    'Existing categorySlug options (or create new):',
    categoriesList,
    '',
    'Existing authorSlug options (or create new with required fields):',
    authorsList,
    '',
    'Required JSON schema:',
    '{',
    '  "headline": string,  // <= 140 chars',
    '  "subheadline": string|null,  // <= 220 chars',
    '  "excerpt": string|null,  // <= 300 chars',
    '  "bodyMarkdown": string,  // markdown with headings/paragraphs/lists; no code blocks',
    '  "categorySlug": string,  // existing OR new slug',
    '  "authorSlug": string,  // existing OR new slug (if new, provide newAuthorName/Title/Bio)',
    '  "newAuthorName": string|null,  // REQUIRED if authorSlug is new (<= 60 chars)',
    '  "newAuthorTitle": string|null,  // REQUIRED if authorSlug is new (<= 100 chars)',
    '  "newAuthorBio": string|null,  // REQUIRED if authorSlug is new (<= 500 chars)',
    '  "layout": "standard"|"wide"|"opinion",',
    '  "isFeatured": boolean,',
    '  "isHeadline": boolean,',
    '  "imageCaption": string|null,  // <= 160 chars',
    '  "imagePrompt": string|null  // <= 600 chars',
    '}',
    '',
    'CRITICAL: If authorSlug is NOT in the existing list, you MUST provide newAuthorName, newAuthorTitle, AND newAuthorBio. Generate them based on the slug and article context if missing.',
    '',
    validationErrorsSection,
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
  const validation = GeneratedArticleSchema.safeParse(parsed)
  if (validation.success) {
    return validation.data
  }

  if (hasTooBigIssues(validation.error.issues)) {
    return await shortenToSchema({
      bad: parsed,
      categories: args.categories,
      authors: args.authors,
      issues: validation.error.issues,
    })
  }

  throw validation.error
}

async function shortenToSchema(args: {
  bad: unknown
  categories: GeneratorCategoryOption[]
  authors: GeneratorAuthorOption[]
  issues: z.ZodIssue[]
}): Promise<GeneratedArticle> {
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

  const systemPrompt = [
    'You are a copy editor for JSON outputs.',
    'Shorten ONLY the fields listed to meet max length limits.',
    'Do not truncate mid-word; rewrite to fit while preserving meaning and tone.',
    'Output MUST be strict JSON only, no markdown fences, no extra text.',
    'categorySlug can be existing OR new. authorSlug can be existing OR new (if new, ensure newAuthorName/Title/Bio are provided).',
    'If the input has a new authorSlug but is missing newAuthorName/Title/Bio, GENERATE them based on the slug.',
  ].join('\n')

  const userPrompt = [
    'Existing categorySlug options (or create new):',
    categoriesList,
    '',
    'Existing authorSlug options (or create new with required fields):',
    authorsList,
    '',
    'Fields that exceed max length:',
    describeTooBigIssues(args.issues),
    '',
    'JSON schema:',
    '{',
    '  "headline": string,  // <= 140 chars',
    '  "subheadline": string|null,  // <= 220 chars',
    '  "excerpt": string|null,  // <= 300 chars',
    '  "bodyMarkdown": string,  // markdown with headings/paragraphs/lists; no code blocks',
    '  "categorySlug": string,  // existing OR new',
    '  "authorSlug": string,  // existing OR new (if new, provide newAuthorName/Title/Bio)',
    '  "newAuthorName": string|null,  // REQUIRED if authorSlug is new (<= 60 chars)',
    '  "newAuthorTitle": string|null,  // REQUIRED if authorSlug is new (<= 100 chars)',
    '  "newAuthorBio": string|null,  // REQUIRED if authorSlug is new (<= 500 chars)',
    '  "layout": "standard"|"wide"|"opinion",',
    '  "isFeatured": boolean,',
    '  "isHeadline": boolean,',
    '  "imageCaption": string|null,  // <= 160 chars',
    '  "imagePrompt": string|null  // <= 600 chars',
    '}',
    '',
    'CRITICAL: If authorSlug is NOT in the existing list, you MUST provide newAuthorName, newAuthorTitle, AND newAuthorBio.',
    '',
    'Fix this JSON by shortening only the fields above:',
    JSON.stringify(args.bad),
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  const jsonText = extractFirstJsonObject(text)
  const parsed = JSON.parse(jsonText) as unknown
  const validation = GeneratedArticleSchema.safeParse(parsed)

  if (!validation.success) {
    throw validation.error
  }

  return validation.data
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
    temperature: 1.5,
  })

  // 25% chance to use the new feature/soft news/local/crime/news story prompt type
  // HARDCODED TO TRUE FOR TESTING - remove this line to restore random selection
  const useFeatureStoryPrompt = Math.random() < 0.25

  // Story types for the new prompt
  const storyTypes = [
    'feature story',
    'feature',
    'soft news',
    'local story',
    'crime story',
    'crime report',
    'news story',
  ]
  const selectedStoryType = storyTypes[Math.floor(Math.random() * storyTypes.length)]

  // Concrete, specific Berlin scenarios for feature/soft news/local/crime/news stories
  // These are designed to be absurd, surreal, patafisic, and NOT abstract
  const concreteBerlinScenarios = [
    // Feature stories - deep dives into absurd situations
    'A man in Wedding who has been trying to get an Anmeldung appointment for 3 years, documenting every rejection in a scrapbook',
    'The underground network of Späti owners who secretly run a barter economy using expired snacks as currency',
    'A former Berghain bouncer who now works as a life coach, teaching people how to get rejected with dignity',
    'The last remaining payphone in Berlin and the people who still use it (and why)',
    'A Kreuzberg apartment building where every tenant is convinced their neighbor is a spy',
    'The mysterious disappearance of all the good döner places and the conspiracy theories surrounding it',
    'A Wedding community garden that has become a battleground between anarchists and urban planners',
    'The secret society of Berliners who still use cash and meet in underground locations',
    'A Neukölln café that only serves food to people who can prove they lived here before 2015',
    'The last person in Berlin who still reads physical newspapers and their daily ritual',
    // Soft news - lighter, human interest, absurd but relatable
    'A Späti owner who started a loyalty program but only accepts payment in stories',
    'The Berliner who collects U-Bahn tickets and has amassed over 10,000 of them',
    'A couple who met at a Bürgeramt waiting room and are now planning their wedding there',
    'The man who walks his pet rat through Görlitzer Park every morning at 6am',
    'A Neukölln bar that only plays music from bands that have broken up',
    'The last remaining phone booth operator in Berlin (if such a thing exists)',
    'A Wedding resident who has memorized every BVG delay announcement',
    'The Berliner who refuses to use apps and documents their analog lifestyle on Instagram',
    'A Späti that doubles as a therapy office (unofficially)',
    'The person who has been on the same U-Bahn line for 5 hours because they refuse to pay for a new ticket',
    // Local stories - neighborhood-specific, concrete events
    'Leopoldplatz fountain has been broken for 6 months and locals have started using it as a wishing well',
    'A Wedding street where every building has a different interpretation of "quiet hours"',
    'The great Späti war of Neukölln: two shops across the street in a price war that has lasted 2 years',
    'A Kreuzberg apartment building where the elevator has been "temporarily" out of service since 2019',
    'The Wedding community center that accidentally became a nightclub on weekends',
    'A Neukölln street where every second building is a vape shop and residents are starting to notice',
    'The Leopoldplatz morning market vendor who only accepts payment in compliments',
    'A Wedding park where someone has been leaving cryptic notes in multiple languages for 3 months',
    'The great bike theft of Müllerstraße: 47 bikes disappeared in one night, all replaced with identical scooters',
    'A Neukölln bar that changes its name every month to avoid bad reviews',
    // Wedding Turkish community stories
    'A Turkish-owned döner shop in Wedding that has been run by the same family for 30 years, now facing gentrification',
    'A Wedding Turkish grocery store owner who knows every customer by name and their shopping habits',
    'The Turkish barbershop in Wedding where men gather to discuss neighborhood news and politics',
    'A Turkish family in Wedding who has lived in the same apartment for 3 generations, watching the neighborhood change',
    'The Turkish community center in Wedding that doubles as a wedding hall (actual weddings, not the neighborhood)',
    'A Wedding street where Turkish-owned businesses line one side, new hipster cafés line the other',
    'The Turkish bakery in Wedding that opens at 5am and serves the neighborhood before anyone else is awake',
    // Crime stories - absurd but specific criminal activities
    'Police investigate a string of döner thefts where only the vegetables are taken, meat left behind',
    'The great Späti heist: someone stole 200 euros worth of energy drinks but left the cash register untouched',
    'A Wedding man arrested for "aggressive passive-aggressive note writing" after neighbors complain',
    'The mysterious case of the disappearing U-Bahn seats: 12 seats vanished overnight, replaced with yoga mats',
    'Police called to Leopoldplatz after someone reports "suspiciously organized" trash',
    'The great bike lock conspiracy: someone has been adding extra locks to random bikes across Wedding',
    'A Neukölln man charged with "excessive politeness" after holding up a U-Bahn for 15 minutes',
    'The case of the phantom Späti robber: someone keeps "robbing" shops but only takes expired products',
    'Police investigate a string of "reverse pickpocketing" where wallets are being added to peoples pockets',
    'The great Anmeldung document heist: someone stole only the appointment confirmation slips',
    // Clans (Berlin mafia) stories
    'A Neukölln shisha bar owner discovers his business is being used as a front for organized crime, but the crime is more efficient than his actual business',
    'The great Clan wedding scandal: a family crime network throws a wedding that costs more than the average Berlin apartment, paid for in cash',
    'Police investigate why a Clan-controlled döner shop has better customer service than Deutsche Bahn',
    "A Wedding resident discovers their new neighbor is a Clan member, but he's more polite than their last neighbor",
    'The case of the gentrified crime: Berlin Clans start opening artisanal coffee shops as fronts',
    'A Neukölln Clan family opens a "legitimate" business empire, but their accounting is more organized than the German tax office',
    'The great Clan turf war: two families fight over control of a Späti, but the conflict is resolved faster than a Bürgeramt appointment',
    'Police called to investigate a Clan wedding that lasted 3 days and disrupted the entire neighborhood, but everyone was too polite to complain',
    // News stories - current events but absurd and specific
    'Berlin announces new initiative: "Quiet Hours" will now be enforced by trained pigeons',
    'BVG introduces new policy: delays over 30 minutes will be rewarded with free döner vouchers',
    'Wedding district council votes to rename all streets after Späti products',
    'Berlin housing authority announces new program: apartments will be assigned by lottery, winners get a WG room',
    'The great Berlin trash strike: garbage collectors demand recognition as performance artists',
    'BVG announces new U-Bahn line that only runs on Tuesdays and only goes in circles',
    'Wedding introduces new tax: "Expat presence fee" to be paid in cash at random Spätis',
    'Berlin announces all new buildings must include a "Berghain waiting area" in the lobby',
    'The great Berlin WiFi crisis: public networks now require a 3-hour orientation session',
    'Wedding district votes to make every day "Späti Appreciation Day"',
  ]
  const selectedScenario =
    concreteBerlinScenarios[Math.floor(Math.random() * concreteBerlinScenarios.length)]

  // Randomly pick a topic focus to force variety (aligned with site categories)
  const topicFocuses = [
    // Bureaucracy
    'Bürgeramt nightmares, appointment systems, or German paperwork hell',
    'Berlin bureaucracy, forms in triplicate, or civil servant attitudes',
    'the sadistic joy German officials take in rejecting incomplete forms',
    // Leopoldplatz
    'Leopoldplatz happenings, the fountain crowd, or Wedding central life',
    'Leopoldplatz characters, street vendors, or the morning drunks',
    'the unofficial Leopoldplatz economy of questionable transactions',
    // Wedding neighborhood character
    "Wedding's Turkish community, Turkish-owned businesses, or Turkish families in the neighborhood",
    'Turkish döner shops in Wedding, Turkish grocery stores, or Turkish community life',
    "the mix of Turkish and German cultures in Wedding, or Turkish families who've lived in Wedding for generations",
    'Turkish-owned Spätis, Turkish barbershops, or Turkish community events in Wedding',
    // Nightlife
    'Berlin techno clubs, Berghain door policy, or nightlife culture',
    'after-hours clubs, sunrise sessions, or the walk of shame home',
    'the desperate measures people take to get into Berghain',
    'club bathroom hookups, darkroom etiquette, or fetish night mishaps',
    // Crime
    'bike theft epidemic, stolen e-scooters, or neighborhood watch drama',
    'petty crime in Berlin, suspicious activity, or police blotter absurdity',
    'Späti robberies, U-Bahn pickpockets, or street dealer turf wars',
    'organized crime disguised as döner shops or shisha bars',
    // Clans (Berlin mafia)
    'Berlin Clans, family crime networks, or organized crime in Neukölln and Wedding',
    'Clan-controlled businesses, shisha bars as fronts, or the Remmo family',
    'the absurdity of Berlin mafia operating döner shops and car dealerships',
    'Clan turf wars, protection rackets, or the gentrification of organized crime',
    'the intersection of Berlin Clans and legitimate business empires',
    'Clan weddings that cost more than most Berlin apartments',
    'the bureaucratic efficiency of Berlin Clans vs the inefficiency of German bureaucracy',
    // Techno
    'Berlin techno scene, DJ drama, or warehouse rave culture',
    'Berghain rejection stories, club outfit disasters, or bouncer psychology',
    'washed-up DJs clinging to relevance, or techno bro philosophy',
    // Doener & Drinks
    'döner kebab culture, späti life, or Berlin food scene',
    'best döner debates, kebab rankings, or late-night munchies',
    'the mystery meat in your 3am döner, or health code violations',
    // Kiez News
    'local neighborhood drama, kiez gossip, or community board meetings',
    'BVG transit delays, U-Bahn drama, or S-Bahn chaos',
    'new hipster café openings, shop closures, or rent hikes on your block',
    'passive-aggressive notes in apartment buildings, or neighbor feuds',
    // Gentrification - expanded
    'gentrification battles, rent protests, or neighborhood changes',
    'expat invasion, English menus everywhere, or "authentic" Berlin debates',
    'trust fund kids cosplaying as poor artists in Neukölln',
    'Americans ruining everything they touch in Berlin',
    'the slow death of Spätis as organic juice bars take over',
    'when your favorite dive bar becomes a craft cocktail lounge',
    'neighborhoods that lost their soul to brunch culture',
    'the great Neukölln exodus: where did all the artists go?',
    'rent control protests that accomplish nothing but make everyone feel better',
    'the gentrification Olympics: who can complain the loudest?',
    // Startup culture - expanded
    'startup culture, co-working spaces, or tech bros pricing out locals',
    'the WeWorkification of Berlin: every café is now a co-working space',
    'tech bros explaining blockchain to confused baristas',
    'startup founders who think their app will save the world',
    'the cult of productivity: why everyone in Berlin has a side hustle',
    'venture capital money ruining perfectly good dive bars',
    'the rise of "disruptive" companies that just sell coffee',
    'startup pitch nights where dreams go to die',
    'tech bros who moved here for "cheap rent" and immediately raised prices',
    'the Berlin startup scene: where good ideas go to get funded and forgotten',
    'co-working spaces that charge 500 euros for a desk and free kombucha',
    'the performative minimalism of startup founders',
    'when your startup fails but you still call yourself an entrepreneur',
    // Yoga, mindfulness, veganism - expanded
    'yoga studios opening where punk squats used to be',
    'the performative wellness of Berlin Instagram',
    'vegan restaurants that cost more than a steakhouse',
    'mindfulness retreats for people who need therapy',
    'the yoga-to-crypto pipeline: how spiritual became financial',
    'vegan activists who still wear leather',
    'meditation apps that make you more anxious',
    'the gentrification of mindfulness: when self-care becomes a luxury good',
    'yoga teachers who charge 30 euros for "finding your inner peace"',
    'the absurdity of Berlin wellness culture',
    'vegan brunch spots that serve avocado toast for 18 euros',
    'mindfulness workshops for people who just need to touch grass',
    'the hypocrisy of wellness influencers promoting detox while doing drugs',
    'yoga retreats in Brandenburg: paying 500 euros to sleep in a tent',
    'vegan cheese that tastes like sadness',
    'the commodification of spirituality in Berlin',
    'mindfulness as an excuse to avoid real problems',
    'yoga pants that cost more than your rent',
    'the Berlin wellness industrial complex',
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
    // Edgier topics
    'polyamory as an excuse for commitment issues in Berlin',
    'vegans who still do cocaine on weekends',
    'the performative activism of Instagram Berliners',
    'rich kids pretending to be broke while daddy pays the rent',
    'the hypocrisy of Berliners who complain about tourists while being expats themselves',
    'sex work, Oranienstraße corners, or the German approach to legalized prostitution',
    'Berlin influencers with 47 followers calling themselves content creators',
    'the mid-30s identity crisis of people who moved here for techno',
    'Germans lecturing everyone on morality while their grandfathers did what exactly',
    'the subtle racism of "where are you REALLY from" conversations',
    'leftist infighting, purity tests, and eating their own',
    // Drugs - expanded
    'ketamine as a personality substitute in Berlin',
    'the dealer hierarchy at Görlitzer Park, or drug tourism',
    'microdosing tech bros who think LSD makes them Steve Jobs',
    'people who base their entire identity around doing MDMA',
    'the cocaine-to-meditation pipeline of Berlin wellness culture',
    'speed as the unofficial currency of Berlin nightlife',
    'GHB mishaps and the fine line between party and ambulance',
    'drug dealers with better customer service than Deutsche Bahn',
    'the gentrification of drug culture—artisanal cocaine and organic weed',
    // Decadence - expanded
    'sex parties marketed as "networking events"',
    'the three-day bender that turned into a lifestyle',
    'KitKat dress codes and the nudity-as-personality phenomenon',
    'people who havent seen daylight since 2019',
    'the Berlin tradition of turning every brunch into day drinking',
    'after-hour clubs where time has no meaning and neither does hygiene',
    'orgies disguised as art installations',
    'the dark tourist economy of Berlin hedonism',
    'people whose only accomplishment is attending every Berghain opening',
    // High rents & housing crisis
    'paying 1500 euros for a WG room the size of a coffin',
    'landlords who think a 40sqm apartment is worth more than a Munich villa',
    'the WG casting process thats more intense than a job interview',
    'Airbnb destroying neighborhoods while tourists complain about authenticity',
    'the delusion of ever owning property in Berlin',
    'rent increases forcing artists out so yoga studios can move in',
    'Zwischenmiete scams and the housing black market',
    'people paying 2000 euros to live next to a döner that never closes',
    'the absurdity of Wohnungsbesichtigung lines around the block',
    // Declining art scene
    'galleries closing so another vape shop can open',
    'the death of Berlin underground culture, killed by Instagram',
    'artists who moved here for cheap rent now working in tech',
    'street art being replaced by corporate murals',
    'the commodification of everything that made Berlin interesting',
    'when your art collective becomes a brand partnership',
    'the Berlin art scene: now sponsored by Red Bull',
    'creative spaces turned into coworking for crypto startups',
    'the last real artist in Berlin turns 65 and still cant afford retirement',
    // Deutsche Bahn disasters
    'Deutsche Bahn: where 10 minutes late is considered on time',
    'the eternal construction at Berlin Hauptbahnhof',
    'ICE trains breaking down in creative new ways',
    'DB customer service as a form of psychological warfare',
    'train delays blamed on weather, leaves, sun, existence',
    'the mystery of why German trains cost more but work less than everywhere else',
    'Bahnhof homeless populations and the citys non-solutions',
    'regional trains cancelled due to "operational reasons" (no one knows what)',
    'the 49-euro ticket and the chaos it unleashed',
    'S-Bahn Berlin: an unreliable service wrapped in an apology',
    // Opinion/Essay pieces (these should trigger layout: "opinion" and categorySlug: "opinion")
    '[OPINION] Why I stopped apologizing for not speaking German after 5 years',
    '[OPINION] Berlin was better when I first moved here (and so was I)',
    '[OPINION] In defense of being a gentrifier—someone has to pay the rent',
    '[OPINION] The myth of Berlin authenticity and why everyone needs to shut up about it',
    '[OPINION] Why I will never leave Berlin (despite hating everything about it)',
    '[OPINION] Against minimalism: my 40sqm apartment has 200 houseplants and I regret nothing',
    '[OPINION] The case for being rude to tourists—they deserve it',
    '[OPINION] Stop pretending you moved here for the culture, you moved here for the drugs',
    '[OPINION] Techno is dead and we killed it with our curated Instagram aesthetics',
    '[OPINION] I hate brunch culture and everyone who participates in it',
    '[OPINION] Dating in Berlin broke me and I blame all of you',
    '[OPINION] The lie of work-life balance in a city where no one works',
    '[OPINION] Why I refuse to get an Anmeldung and you should too',
    '[OPINION] Berghain rejection made me a better person (it didnt)',
    '[OPINION] In praise of being a terrible neighbor',
  ]
  const randomFocus = topicFocuses[Math.floor(Math.random() * topicFocuses.length)]

  // When RSS topics are available, pick one to base the article on
  const rssTopics = input.topicSummary
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
  const hasRssTopics = input.includeTopics && rssTopics.length > 0
  const selectedRssTopic = hasRssTopics
    ? rssTopics[Math.floor(Math.random() * rssTopics.length)]
    : null

  const recentTitlesSection =
    input.recentArticleTitles.length > 0
      ? [
          `\nCRITICAL: DO NOT repeat these recent article topics (${input.recentArticleTitles.length} recent articles shown to avoid repetition):`,
          input.recentArticleTitles.map((title, idx) => `${idx + 1}. ${title}`).join('\n'),
          '',
          'You must write about a COMPLETELY DIFFERENT topic/subject matter. Do not write about similar themes, similar situations, or similar characters.',
          'If you see multiple articles about bureaucracy, write about something else entirely. If you see multiple articles about nightlife, choose a different angle.',
          '',
        ].join('\n')
      : ''

  const headlinePatterns =
    input.recentHeadlinePatterns ?? extractHeadlinePatterns(input.recentArticleTitles)
  const headlinePatternsSection =
    headlinePatterns.length > 0
      ? [
          `\nCRITICAL: AVOID these overused headline patterns (${headlinePatterns.length} patterns detected in recent articles):`,
          headlinePatterns.map((p) => `- "${p}"`).join('\n'),
          '',
          'Your headline MUST use a COMPLETELY DIFFERENT structure. Do NOT use any of the patterns above.',
          '',
          'Examples of varied headline structures you CAN use (if not already overused):',
          '- Question format: "Why [something]?" or "Is [something] the new [something]?"',
          '- Quotation/character focus: "[Character/Group] [does something absurd]"',
          '- Descriptive/observational: "The [absurd thing] of [location/group]"',
          '- Comparison: "[X] vs [Y]: The [absurd comparison]"',
          '- Direct statement: "[Something] is [absurd claim]"',
          '- Narrative: "How [something] became [absurd outcome]"',
          '- Listicle-style: "The [number] ways [something absurd]"',
          '- Absurd claim: "[Something] declares itself [absurd status]"',
          '- Breaking news style: "[Location] [unexpected event] as [absurd detail]"',
          '- Mystery/investigation: "The mystery of [absurd thing] in [location]"',
          '- Personal/confessional: "[Someone] reveals [absurd secret]"',
          '',
          'CRITICAL: Your headline structure must be UNIQUE compared to the recent articles shown above.',
          'If you see "Berlin [verb] [noun]" used multiple times, use a question, a statement, a narrative, or any other structure.',
          'Vary your headline structure! Do NOT default to common patterns.',
        ].join('\n')
      : ''

  // Determine topic instruction based on article type
  const topicInstruction = useFeatureStoryPrompt
    ? [
        `ARTICLE TYPE: ${selectedStoryType.toUpperCase()}`,
        `CONCRETE SCENARIO: ${selectedScenario}`,
        '',
        'CRITICAL INSTRUCTIONS FOR THIS STORY TYPE:',
        '- This is a CONCRETE, SPECIFIC story about a REAL (but absurd) situation in Berlin.',
        '- Write it as a proper news article/feature: who, what, where, when, why.',
        '- Include specific details: street names, neighborhoods, times, numbers, quotes from "witnesses" or "sources".',
        '- Make it ABSURD and SURREAL but grounded in reality. Think patafisic: the science of imaginary solutions.',
        '- The scenario above is your starting point - expand it into a full story with characters, dialogue, and consequences.',
        '- This should read like a real newspaper article, but about something completely ridiculous.',
        '- DO NOT be abstract. Be SPECIFIC. Name streets, times, people (fictional but named), specific locations.',
        '- Include quotes from fictional characters, specific details about the situation, and concrete outcomes.',
        '- The absurdity comes from the situation being real and detailed, not from abstract concepts.',
        '',
        'Examples of the tone:',
        '- "On Tuesday at 3:47pm, Klaus Müller, 47, discovered that his Späti loyalty card had been replaced with a library card..."',
        '- "The incident occurred at the corner of Müllerstraße and Seestraße, where witnesses report seeing..."',
        '- "According to sources at the Wedding district office, the situation began when..."',
        '',
        'This is NOT an opinion piece or abstract satire. This is a NEWS STORY about something absurd but specific.',
      ].join('\n')
    : hasRssTopics && selectedRssTopic
      ? [
          'PRIMARY TOPIC SOURCE: A real-world news headline will be provided. You MUST write a satirical Berlin angle on that news story.',
          `SECONDARY/BACKUP THEME (use only if the news topic is too narrow): ${randomFocus}`,
          'The real news topic takes PRIORITY - find a clever Berlin connection to it.',
        ].join('\n')
      : [
          `TOPIC DIRECTION (use as inspiration, NOT as your headline): ${randomFocus}`,
          'CRITICAL: The topic direction above is just a THEME to inspire you. DO NOT copy it as your headline. Create your OWN original, clever headline that relates to the theme but is distinctly different wording.',
        ].join('\n')

  const systemPrompt = [
    'You are a satire writer for "The Wedding Times", a fictional satirical newspaper covering Berlin.',
    'Language: write everything in US English (no German, no other languages).',
    '',
    'CRITICAL: "Wedding" (capitalized) refers to Wedding, a neighborhood in Berlin, NOT a wedding ceremony.',
    'DO NOT write articles about wedding ceremonies, marriage, brides, grooms, wedding planning, or wedding-related topics.',
    'The newspaper is named "The Wedding Times" because it covers the Wedding neighborhood in Berlin.',
    'When you see "Wedding" in context, it means the Berlin neighborhood (like Kreuzberg, Neukölln, Mitte, etc.), not a marriage ceremony.',
    'Write about life in the Wedding neighborhood, not about weddings as events.',
    '',
    "IMPORTANT CONTEXT: Wedding is a neighborhood with a significant Turkish community. This is a natural, integral part of the neighborhood's character.",
    "When writing about Wedding, it's natural and appropriate to mention Turkish businesses, Turkish families, Turkish cultural elements, Turkish-owned shops, etc.",
    'The Turkish community is fair game for satire and edgy humor—make fun of them like you make fun of everyone else. But avoid racist stereotypes, slurs, or hateful content.',
    "Turkish döner shops, Turkish families, Turkish community events, Turkish-owned businesses are all part of Wedding's reality and should be mentioned when relevant.",
    "Satirize Turkish community elements with the same edgy, politically incorrect approach you use for everything—just don't be racist about it.",
    '',
    useFeatureStoryPrompt
      ? [
          'Tone: Deadpan, serious journalism about absurd situations, but with an edge. Write with the straight-faced seriousness of a real news reporter covering something completely ridiculous, but push boundaries. The humor comes from the contrast between the serious tone and the absurd content, but also from making readers uncomfortable—they should think "I don\'t know if I should laugh at this".',
          'Style: Write like a real local newspaper journalist—specific, detailed, factual-sounding but about something surreal. Include concrete details: names, addresses, times, quotes. Make it read like a real news article from a serious paper, but the story is absurd AND edgy. Challenge comfort zones. Make readers question their own reactions.',
          'CRITICAL: This must be CONCRETE and SPECIFIC. No abstract concepts. Real names (fictional), real addresses, real times, real quotes. The absurdity is in the situation, not in abstract satire. But push it further—make it uncomfortable, politically incorrect, challenging.',
          '',
          'EDGE AND POLITICAL INCORRECTNESS:',
          '- Go beyond "nice absurdity". Make readers uncomfortable. Challenge their assumptions.',
          '- Tackle taboo subjects with dark humor. Make fun of everyone equally—no sacred cows.',
          '- The goal is "I don\'t know if I should laugh" not "haha that\'s cute"',
          '- Push boundaries. Be provocative. Make people think "can they say that?"',
          '- Use dark humor, shock value, and uncomfortable truths wrapped in absurdity',
          "- Don't be mean-spirited, but don't be safe either. Make readers squirm a little.",
          '',
          'SPICE IT UP (subtle sexual innuendo):',
          '- Include 2-3 subtle double entendres or sexual innuendo that can be read innocently or suggestively',
          '- Use phrases that have a second, sexual meaning when read carefully (e.g., "penetrating the bureaucracy", "deep dive into the matter", "hard to swallow", "stiff resistance")',
          '- Keep it clever—readers should catch the double meaning',
          '- NOT explicit, NOT vulgar—just playful wordplay with sexual undertones',
          '',
          'INTELLECTUAL EASTER EGGS (MORE PROMINENT):',
          '- Include 3-5 witty, creative cultural references per article—make them visible but clever',
          '- Reference: literature, philosophy, film, contemporary art, academic theory, cultural movements, architectural concepts, urban studies',
          '- These should be recognizable to educated readers, but woven in with WIT and CREATIVITY',
          '- DO NOT copy examples—come up with your OWN creative, witty references',
          '- Think broadly: literary allusions, philosophical concepts, film references, art movements, cultural theory, architectural ideas',
          '- Possible sources (be creative, vary them): Kafka, Derrida, Baudrillard, Debord, Benjamin, Adorno, contemporary artists, Situationists, etc.',
          '- Make references witty and contextually appropriate—they should feel natural, not forced',
          '- The goal is clever cultural commentary, not academic name-dropping',
          "- Vary your references—don't repeat the same ones in every article",
        ].join('\n')
      : [
          'Tone: irreverent, subversive, and unapologetically politically incorrect. Channel the spirit of early South Park, Anthony Jeselnik, and classic British satire like Brass Eye. Mock sacred cows, poke fun at every demographic equally, and embrace taboo topics with gleeful abandon. Use dark humor, shock value, and absurdist takes on sensitive subjects. Nothing is off-limits except actual hate speech or calls to violence.',
          'Style: write like a hungover journalist who has stopped caring about keeping their job—biting sarcasm, cynical observations, and jokes that make readers say "they cant print that".',
          '',
          'EDGE AND POLITICAL INCORRECTNESS:',
          '- Go beyond "nice absurdity". Make readers uncomfortable. Challenge their assumptions.',
          '- The goal is "I don\'t know if I should laugh" not "haha that\'s cute"',
          '- Push boundaries. Be provocative. Make people think "can they say that?"',
          '- Use dark humor, shock value, and uncomfortable truths wrapped in absurdity',
          "- Don't be mean-spirited, but don't be safe either. Make readers squirm a little.",
          '- Tackle taboo subjects. Make fun of everyone equally—no sacred cows.',
          '',
          'SPICE IT UP (subtle sexual innuendo):',
          '- Include 2-3 subtle double entendres or sexual innuendo that can be read innocently or suggestively',
          '- Use phrases that have a second, sexual meaning when read carefully (e.g., "penetrating the bureaucracy", "deep dive into the matter", "hard to swallow", "stiff resistance")',
          '- Keep it clever—readers should catch the double meaning',
          '- NOT explicit, NOT vulgar—just playful wordplay with sexual undertones',
          '',
          'INTELLECTUAL EASTER EGGS (MORE PROMINENT):',
          '- Include 3-5 witty, creative cultural references per article—make them visible but clever',
          '- Reference: literature, philosophy, film, contemporary art, academic theory, cultural movements, architectural concepts, urban studies',
          '- These should be recognizable to educated readers, but woven in with WIT and CREATIVITY',
          '- DO NOT copy examples—come up with your OWN creative, witty references',
          '- Think broadly: literary allusions, philosophical concepts, film references, art movements, cultural theory, architectural ideas',
          '- Possible sources (be creative, vary them): Kafka, Derrida, Baudrillard, Debord, Benjamin, Adorno, contemporary artists, Situationists, etc.',
          '- Make references witty and contextually appropriate—they should feel natural, not forced',
          '- The goal is clever cultural commentary, not academic name-dropping',
          "- Vary your references—don't repeat the same ones in every article",
        ].join('\n'),
    topicInstruction,
    recentTitlesSection,
    headlinePatternsSection,
    'CRITICAL: Pick a categorySlug that BEST matches your assigned topic direction above.',
    'Category mapping guide:',
    '- Drugs/ketamine/club bathroom → drugs',
    '- Techno/Berghain/DJ/warehouse rave → techno',
    '- Decadence/after-parties/hedonism → decadence',
    '- Filth/trash/cleaning/rats → filth',
    '- Bureaucracy/forms/appointments → bureaucracy',
    '- Leopoldplatz/fountain → leopoldplatz',
    '- Nightlife/clubs/parties → nightlife',
    '- Food/kebab/späti → food-drink',
    '- Crime/theft/police/Clans/organized crime → crime',
    '- Local news/kiez/BVG → kiez',
    '- Rent/gentrification/expats/startup culture/co-working/tech bros → gentrification',
    '- Yoga/mindfulness/veganism/wellness/meditation → gentrification (wellness gentrification)',
    '- Opinion/editorial → opinion',
    'DO NOT default to bureaucracy, nightlife, or opinion unless your topic truly matches.',
    'IMPORTANT: Startup culture, yoga studios, mindfulness retreats, and vegan restaurants are forms of gentrification—map them to "gentrification" category.',
    '',
    'OPINION PIECE FORMAT (when categorySlug is "opinion" and layout is "opinion"):',
    '- Write as a PERSONAL ESSAY, not a news article.',
    '- Use FIRST PERSON throughout ("I", "my", "we").',
    '- Open with a provocative thesis or hot take that the author is defending.',
    '- Structure like an essay: intro with thesis → arguments/anecdotes → conclusion that drives the point home.',
    '- Include personal observations, rants, and the authors lived experience in Berlin.',
    '- Be MORE opinionated, MORE aggressive, MORE unhinged than regular articles.',
    '- Think: drunk columnist ranting at a dinner party, David Sedaris meets Hunter S. Thompson.',
    '- The author should have strong, possibly unreasonable opinions they defend passionately.',
    '- End with a memorable closing line or call to action.',
    '',
    'Remember: punch in all directions, mock everyone, but avoid slurs or explicit calls for harm.',
    '',
    'IMAGE GENERATION:',
    'You MUST provide an imagePrompt for almost every article. Think: what photo would a real newspaper use to illustrate this story?',
    'The imagePrompt should be a detailed, visual description of a photorealistic image (no text overlays).',
    'Only omit imagePrompt if the story is truly unillustratable (very rare).',
    '',
    'Output MUST be strict JSON only, no markdown fences, no extra text.',
  ].join('\n')

  const categoriesList = safeStringList(input.categories)
  const authorsList = safeStringList(input.authors)

  const topicsSection = useFeatureStoryPrompt
    ? [
        `STORY TYPE: ${selectedStoryType}`,
        `SCENARIO TO EXPAND: ${selectedScenario}`,
        '',
        'YOUR TASK: Write a complete news article/feature about this scenario.',
        '',
        'REQUIREMENTS:',
        '- Write it as a REAL news article with proper journalistic structure',
        '- Include specific details: names (fictional but realistic), addresses, times, dates',
        '- Add quotes from fictional characters/sources',
        '- Describe the situation, its causes, and its consequences',
        '- Make it absurd and surreal but treat it with journalistic seriousness',
        '- Include concrete details: "On Tuesday morning at 8:47am, residents of Müllerstraße 23 noticed..."',
        '- Name specific Berlin locations, streets, neighborhoods',
        '- Include dialogue, witness accounts, official statements (all fictional but realistic)',
        '- The article should be 300-600 words of detailed, specific reporting',
        '- MUST provide an imagePrompt: describe a photorealistic photo that would illustrate this news story (e.g., "A broken fountain at Leopoldplatz with people throwing coins into it, urban Berlin setting")',
        '',
        'EDGE AND POLITICAL INCORRECTNESS:',
        '- Push beyond "nice absurdity". Make readers uncomfortable. Challenge assumptions.',
        '- The goal is "I don\'t know if I should laugh" not "haha that\'s cute"',
        '- Tackle taboo subjects with dark humor. Make fun of everyone equally.',
        '- Use uncomfortable truths wrapped in absurdity. Make readers squirm.',
        '',
        'CRITICAL REMINDER: "Wedding" (capitalized) refers to Wedding, the Berlin neighborhood, NOT a wedding ceremony.',
        'DO NOT write about wedding ceremonies, marriage, brides, grooms, wedding planning, or wedding-related topics.',
        'Write about life in the Wedding neighborhood, not about weddings as events.',
        '',
        'IMPORTANT: Wedding has a significant Turkish community. When writing about Wedding, naturally mention Turkish businesses, Turkish families, Turkish cultural elements when relevant.',
        'The Turkish community is fair game for satire—make fun of them like everyone else. But avoid racist stereotypes, slurs, or hateful content.',
        '',
        'TONE: Deadpan, serious journalism about something completely ridiculous, but with an edge. Like The Onion but more detailed, specific, AND uncomfortable. Make readers question their own reactions.',
        'STYLE: Read like a real local newspaper article. Who, what, where, when, why, how - all answered with absurd but specific details. But push boundaries. Challenge comfort zones.',
        '',
        'INTELLECTUAL EASTER EGGS (MORE PROMINENT):',
        '- Include 3-5 witty, creative cultural references per article—make them visible but clever',
        '- Reference: literature, philosophy, film, contemporary art, academic theory, cultural movements, architectural concepts, urban studies',
        '- DO NOT copy examples—come up with your OWN creative, witty references',
        '- Think broadly: literary allusions, philosophical concepts, film references, art movements, cultural theory',
        '- Possible sources (be creative, vary them): Kafka, Derrida, Baudrillard, Debord, Benjamin, Adorno, contemporary artists, Situationists, etc.',
        '- Make references witty and contextually appropriate—they should feel natural, not forced',
        '- The goal is clever cultural commentary, not academic name-dropping',
        "- Vary your references—don't repeat the same ones in every article",
        '',
      ].join('\n')
    : hasRssTopics && selectedRssTopic
      ? [
          'CURRENT NEWS TOPIC TO SATIRIZE:',
          selectedRssTopic,
          '',
          'CRITICAL INSTRUCTION: You MUST write a satirical article that connects this real-world news topic to Berlin.',
          'Take the essence/theme of this news story and write about how it manifests in Berlin, the Wedding neighborhood, or the Berlin expat/local scene.',
          'REMINDER: "Wedding" refers to the Berlin neighborhood, NOT wedding ceremonies. Do NOT write about weddings, marriage, or wedding-related topics.',
          'Examples of how to connect:',
          '- If the news is about a tech company layoff, write about how Berlin startups are affected or how laid-off tech bros are now DJing',
          '- If the news is about politics, write about how Berliners react to it at their local Späti or how it affects the bureaucracy',
          '- If the news is about climate, write about Berlin climate activists or how Berliners are coping',
          '- If the news is about economy/inflation, write about Berlin rent, döner prices, or club entry fees',
          '',
          'The connection to the real news should be CLEAR in the article, not just vaguely inspired.',
          'Your satirical angle should make fun of both the news topic AND Berlin culture simultaneously.',
          '',
        ].join('\n')
      : 'No external topics provided. Invent plausible Berlin-related satire based on the topic focus above.\n'

  const userPrompt = [
    topicsSection,
    'Important: ALL text fields must be written in US English.',
    '',
    useFeatureStoryPrompt
      ? [
          'CRITICAL FOR FEATURE/NEWS STORIES:',
          '- Your article MUST be concrete and specific. Include:',
          '  * Specific names of people (fictional but realistic: "Klaus Müller", "Sarah Schmidt", etc.)',
          '  * Specific addresses and locations ("Müllerstraße 23", "corner of Seestraße and Leopoldplatz")',
          '  * Specific times and dates ("Tuesday morning at 8:47am", "last Thursday")',
          '  * Quotes from sources ("According to Müller, the situation began when...")',
          '  * Specific numbers and details ("47 bikes", "3 years", "200 euros")',
          '  * Specific consequences and outcomes',
          '- Write it like a REAL news article with proper structure: lead paragraph, body with details, conclusion',
          '- The absurdity comes from the situation being treated seriously, not from abstract concepts',
          '- NO abstract philosophical musings. ONLY concrete, specific details about the scenario.',
          '- Think: "A real journalist would write this story with these details"',
          '',
          'SPICE IT UP - Subtle Sexual Innuendo:',
          '- Include 2-3 subtle double entendres naturally woven into the text',
          '- Examples: "residents found it hard to swallow the new policy", "the committee struggled to penetrate the bureaucracy", "the proposal met with stiff resistance"',
          '- Keep it clever and subtle—readers should catch the double meaning on a second read',
          '- NOT explicit or vulgar—just playful wordplay',
          '',
          'INTELLECTUAL EASTER EGGS:',
          '- Include 2-3 witty, creative cultural references to literature, philosophy, art, film, or academic concepts',
          '- DO NOT copy examples—come up with your OWN creative references',
          '- Weave them naturally with wit: literary allusions, philosophical concepts, film references, art movements, cultural theory',
          '- Think: educated readers will recognize the reference, but the article still works without it',
          "- Be creative and varied—don't repeat the same references",
          '- The goal is clever cultural commentary, not academic name-dropping',
          '',
        ].join('\n')
      : '',
    'AUTHOR SELECTION:',
    'You have two options for the author:',
    '1. Pick an existing author from the list below (use their slug as authorSlug)',
    '2. CREATE A NEW AUTHOR (strongly encouraged ~50% of the time!) - invent a fictional journalist with a unique personality',
    '',
    'If creating a NEW author:',
    '- Set authorSlug to a new unique slug (lowercase, hyphens, e.g. "klaus-bierstein")',
    '- MUST provide newAuthorName (full name, e.g. "Klaus Bierstein")',
    '- MUST provide newAuthorTitle (their role/beat, e.g. "Nightlife Correspondent", "Bureaucracy Survivor", "Gentrification Watch Reporter", "Crime Reporter", "Local News Correspondent")',
    '- MUST provide newAuthorBio (2-3 sentences about them - make it funny, sarcastic, and fitting for a satirical paper)',
    '',
    'Return an article that could plausibly run on the front page of a satirical local paper.',
    '',
    'CRITICAL REMINDER: "Wedding" (capitalized) refers to Wedding, the Berlin neighborhood, NOT a wedding ceremony.',
    'DO NOT write about wedding ceremonies, marriage, brides, grooms, wedding planning, or wedding-related topics.',
    'The newspaper covers the Wedding neighborhood in Berlin. Write about life in Wedding, not about weddings as events.',
    '',
    'IMPORTANT: Wedding has a significant Turkish community. When writing about Wedding, naturally mention Turkish businesses, Turkish families, Turkish cultural elements when relevant.',
    'The Turkish community is fair game for satire—make fun of them like everyone else. But avoid racist stereotypes, slurs, or hateful content.',
    '',
    !useFeatureStoryPrompt
      ? [
          'EDGE AND POLITICAL INCORRECTNESS:',
          '- Push beyond "nice absurdity". Make readers uncomfortable. Challenge assumptions.',
          '- The goal is "I don\'t know if I should laugh" not "haha that\'s cute"',
          '- Tackle taboo subjects with dark humor. Make fun of everyone equally.',
          '- Use uncomfortable truths wrapped in absurdity. Make readers squirm.',
          '',
          'SPICE IT UP - Subtle Sexual Innuendo:',
          '- Include 2-3 subtle double entendres naturally woven into the text',
          '- Examples: "residents found it hard to swallow the new policy", "the committee struggled to penetrate the bureaucracy", "the proposal met with stiff resistance"',
          '- Keep it clever—readers should catch the double meaning',
          '- NOT explicit or vulgar—just playful wordplay',
          '',
          'INTELLECTUAL EASTER EGGS (MORE PROMINENT):',
          '- Include 3-5 witty, creative cultural references per article—make them visible but clever',
          '- Reference: literature, philosophy, film, contemporary art, academic theory, cultural movements, architectural concepts, urban studies',
          '- DO NOT copy examples—come up with your OWN creative, witty references',
          '- Think broadly: literary allusions, philosophical concepts, film references, art movements, cultural theory',
          '- Possible sources (be creative, vary them): Kafka, Derrida, Baudrillard, Debord, Benjamin, Adorno, contemporary artists, Situationists, etc.',
          '- Make references witty and contextually appropriate—they should feel natural, not forced',
          '- The goal is clever cultural commentary, not academic name-dropping',
          "- Vary your references—don't repeat the same ones in every article",
          '',
        ].join('\n')
      : '',
    'HEADLINE VARIETY IS CRITICAL:',
    useFeatureStoryPrompt
      ? [
          'For feature/news stories, use traditional news headline formats:',
          '- Direct, factual-sounding headlines: "Wedding Man Discovers Späti Loyalty Card Replaced with Library Card" (Note: "Wedding" here refers to the Berlin neighborhood, not a wedding ceremony)',
          '- Question format: "Why Did 47 Bikes Disappear from Müllerstraße?"',
          '- Descriptive: "The Great Späti War of Neukölln Enters Third Year"',
          '- Avoid overly clever wordplay - keep it news-like but absurd',
        ].join('\n')
      : [
          'Your headline structure must be creative and varied. Avoid repetitive patterns like "Berlin [verb] [noun]".',
          'Use different structures: questions, character-focused, descriptive, comparisons, direct statements, narratives, etc.',
          'Think like a real newspaper: headlines should grab attention with wit, not formula.',
        ].join('\n'),
    '',
    'CATEGORY SELECTION:',
    'You have two options for the category:',
    '1. Pick an existing categorySlug from the list below',
    '2. CREATE A NEW CATEGORY (if your topic truly needs a new category) - invent a new category slug (lowercase, hyphens, e.g. "gentrification", "drugs", "decadence")',
    '',
    'categorySlug options (or create new):',
    categoriesList,
    '',
    'Existing authorSlug options (or create new):',
    authorsList,
    '',
    'JSON schema:',
    '{',
    '  "headline": string,  // YOUR OWN original headline - DO NOT copy the topic direction (<= 140 chars)',
    '  "subheadline": string|null,  // <= 220 chars',
    '  "excerpt": string|null,  // <= 300 chars',
    '  "bodyMarkdown": string,  // markdown with headings/paragraphs/lists; no code blocks',
    '  "categorySlug": string,  // existing slug OR new slug if creating category',
    '  "authorSlug": string,  // existing slug OR new slug if creating author',
    '  "newAuthorName": string|null,  // REQUIRED if creating new author (<= 60 chars)',
    '  "newAuthorTitle": string|null,  // REQUIRED if creating new author (their beat/role, <= 100 chars)',
    '  "newAuthorBio": string|null,  // REQUIRED if creating new author (2-3 funny sentences, <= 500 chars)',
    '  "layout": "standard"|"wide"|"opinion",',
    '  "isFeatured": boolean,',
    '  "isHeadline": boolean,',
    '  "imageCaption": string|null,  // <= 160 chars',
    '  "imagePrompt": string|null  // REQUIRED: prompt for an illustrative photorealistic image, no text overlays. Always provide this unless the story truly cannot be illustrated. <= 600 chars',
    '}',
    '',
    'IMPORTANT: You MUST provide an imagePrompt for almost every article. The imagePrompt should be:',
    '- A detailed description of a photorealistic image that would illustrate the article',
    '- Specific, visual, and descriptive (e.g., "A man in a suit holding a stack of papers at a Bürgeramt counter, frustrated expression, bureaucratic setting")',
    '- No text overlays, just a visual description',
    '- Related to the main subject of the article',
    '- Think like a photojournalist: what photo would accompany this news story?',
    '- Only omit imagePrompt if the story is truly unillustratable (very rare)',
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)

  try {
    const jsonText = extractFirstJsonObject(text)
    const parsed = JSON.parse(jsonText) as unknown
    const validation = GeneratedArticleSchema.safeParse(parsed)
    if (!validation.success) {
      return await repairToSchema({
        badOutput: text,
        categories: input.categories,
        authors: input.authors,
        validationErrors: validation.error.issues,
      })
    }
    const validated = validation.data
    const langSample =
      `${validated.headline}\n${validated.subheadline ?? ''}\n${validated.bodyMarkdown}`.slice(
        0,
        1200,
      )
    const nonEnglish = looksNonEnglish(langSample)

    if (nonEnglish) {
      return await translateToEnglish({
        bad: validated,
        categories: input.categories,
        authors: input.authors,
      })
    }

    return validated
  } catch {
    // Fallback: deterministic repair using cheaper model
    return await repairToSchema({
      badOutput: text,
      categories: input.categories,
      authors: input.authors,
    })
  }
}
