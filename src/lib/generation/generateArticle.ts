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

function extractHeadlinePatterns(titles: string[]): string[] {
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
  }
  
  return Array.from(patterns)
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
    'the sadistic joy German officials take in rejecting incomplete forms',
    // Leopoldplatz
    'Leopoldplatz happenings, the fountain crowd, or Wedding central life',
    'Leopoldplatz characters, street vendors, or the morning drunks',
    'the unofficial Leopoldplatz economy of questionable transactions',
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

  const recentTitlesSection =
    input.recentArticleTitles.length > 0
      ? `\nCRITICAL: DO NOT write about these recent article topics (avoid repetition):\n${input.recentArticleTitles.map((title, idx) => `${idx + 1}. ${title}`).join('\n')}\n\nYou must write about a DIFFERENT topic/subject matter.`
      : ''

  const headlinePatterns = input.recentHeadlinePatterns ?? extractHeadlinePatterns(input.recentArticleTitles)
  const headlinePatternsSection =
    headlinePatterns.length > 0
      ? `\nCRITICAL: AVOID these overused headline patterns (be creative with structure!):\n${headlinePatterns.map((p) => `- "${p}"`).join('\n')}\n\nYour headline MUST use a DIFFERENT structure. Examples of varied structures:\n- Question format: "Why [something]?" or "Is [something] the new [something]?"\n- Quotation/character focus: "[Character/Group] [does something absurd]"\n- Descriptive/observational: "The [absurd thing] of [location/group]"\n- Comparison: "[X] vs [Y]: The [absurd comparison]"\n- Direct statement: "[Something] is [absurd claim]"\n- Narrative: "How [something] became [absurd outcome]"\n- Listicle-style: "The [number] ways [something absurd]"\n- Absurd claim: "[Something] declares itself [absurd status]"\n\nVary your headline structure! Do NOT default to "Berlin [verb] [noun]" or "Wedding [verb] [noun]".`
      : ''

  const systemPrompt = [
    'You are a satire writer for "The Wedding Times", a fictional satirical newspaper covering Berlin.',
    'Language: write everything in US English (no German, no other languages).',
    'Tone: irreverent, subversive, and unapologetically politically incorrect. Channel the spirit of early South Park, Anthony Jeselnik, and classic British satire like Brass Eye. Mock sacred cows, poke fun at every demographic equally, and embrace taboo topics with gleeful abandon. Use dark humor, shock value, and absurdist takes on sensitive subjects. Nothing is off-limits except actual hate speech or calls to violence.',
    'Style: write like a hungover journalist who has stopped caring about keeping their job—biting sarcasm, cynical observations, and jokes that make readers say "they cant print that".',
    `TOPIC DIRECTION (use as inspiration, NOT as your headline): ${randomFocus}`,
    'CRITICAL: The topic direction above is just a THEME to inspire you. DO NOT copy it as your headline. Create your OWN original, clever headline that relates to the theme but is distinctly different wording.',
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
    '- Crime/theft/police → crime',
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
    '',
    'AUTHOR SELECTION:',
    'You have two options for the author:',
    '1. Pick an existing author from the list below (use their slug as authorSlug)',
    '2. CREATE A NEW AUTHOR (strongly encouraged ~50% of the time!) - invent a fictional journalist with a unique personality',
    '',
    'If creating a NEW author:',
    '- Set authorSlug to a new unique slug (lowercase, hyphens, e.g. "klaus-bierstein")',
    '- MUST provide newAuthorName (full name, e.g. "Klaus Bierstein")',
    '- MUST provide newAuthorTitle (their role/beat, e.g. "Nightlife Correspondent", "Bureaucracy Survivor", "Gentrification Watch Reporter")',
    '- MUST provide newAuthorBio (2-3 sentences about them - make it funny, sarcastic, and fitting for a satirical paper)',
    '',
    'Return an article that could plausibly run on the front page of a satirical local paper.',
    '',
    'HEADLINE VARIETY IS CRITICAL:',
    'Your headline structure must be creative and varied. Avoid repetitive patterns like "Berlin [verb] [noun]".',
    'Use different structures: questions, character-focused, descriptive, comparisons, direct statements, narratives, etc.',
    'Think like a real newspaper: headlines should grab attention with wit, not formula.',
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
    '  "headline": string,  // YOUR OWN original headline - DO NOT copy the topic direction',
    '  "subheadline": string|null,',
    '  "excerpt": string|null,  // <= 300 chars',
    '  "bodyMarkdown": string,  // markdown with headings/paragraphs/lists; no code blocks',
    '  "categorySlug": string,  // existing slug OR new slug if creating category',
    '  "authorSlug": string,  // existing slug OR new slug if creating author',
    '  "newAuthorName": string|null,  // REQUIRED if creating new author',
    '  "newAuthorTitle": string|null,  // REQUIRED if creating new author (their beat/role)',
    '  "newAuthorBio": string|null,  // REQUIRED if creating new author (2-3 funny sentences)',
    '  "layout": "standard"|"wide"|"opinion",',
    '  "isFeatured": boolean,',
    '  "isHeadline": boolean,',
    '  "imageCaption": string|null,',
    '  "imagePrompt": string|null  // prompt for an illustrative photo-like image, no text overlays',
    '}',
  ].join('\n')

  console.log('\n' + '='.repeat(80))
  console.log('LLM PROMPT - generateArticle')
  console.log('='.repeat(80))
  console.log('\n--- CATEGORIES FROM DB ---\n')
  console.log(`Total categories: ${input.categories.length}`)
  console.log(categoriesList)
  console.log('\n--- SYSTEM PROMPT ---\n')
  console.log(systemPrompt)
  console.log('\n--- USER PROMPT ---\n')
  console.log(userPrompt)
  console.log('\n' + '='.repeat(80) + '\n')

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

