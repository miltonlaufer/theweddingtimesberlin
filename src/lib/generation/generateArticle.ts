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
  recentArticleExcerpts?: string[] // Optional excerpts (parallel array to titles, truncated to ~150 chars)
  recentHeadlinePatterns?: string[] // Patterns like "Berlin [verb] [noun]" to avoid
  latestArticleContentSample?: string // Half of the latest article's body text to ensure new article is different
  // Variety control for cron job batches
  forceDrugsTechno?: boolean // Force drugs/techno topic (true) or force non-drugs/techno (false), undefined = random 35%
  forceRss?: boolean // Force using RSS topic if available
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
  // RSS source tracking - if article was inspired by an RSS news topic
  sourceRssTopic: z.string().max(300).optional().nullable(),
})

export type GeneratedArticle = z.infer<typeof GeneratedArticleSchema>

export interface GenerateArticleResult {
  article: GeneratedArticle
  /** The RSS topic that was provided to the LLM (if any). Track this server-side for reliability. */
  usedRssTopic: string | null
  /** Whether this article used a drugs/techno topic/scenario. Used for variety tracking. */
  usedDrugsTechno: boolean
}

/******************* PROMPT CONSTANTS ***********************/

// Reusable prompt text blocks to avoid repetition

const INTELLECTUAL_SOURCES = `Literature: Kafka, Hemingway, Cormac McCarthy, Proust, Marguerite Duras, Philip K. Dick, Stendhal, Oscar Wilde, Voltaire. Philosophy: Freud, Lacan, Marx, Hegel, Kant, Plato, Aristotle, Wittgenstein, Heidegger, Husserl, Merleau-Ponty, Kierkegaard, Nietzsche, Bertrand Russell, Quine, Austin, Searle, Rorty, Derrida, Baudrillard, Debord, Benjamin, Adorno, Confucius, I-Ching. Cinema: Truffaut, Coppola, Godard. Art & Music: John Cage, Duchamp, Picasso, Bach, Beethoven, Chopin.`

const INTELLECTUAL_EASTER_EGGS = [
  'INTELLECTUAL EASTER EGGS (MANDATORY - AT LEAST ONE PER ARTICLE):',
  '- EVERY article MUST contain at least one intellectual easter egg (explicit or subtle)',
  '- Include 1-5 witty, creative cultural references per article—make them visible but clever',
  '- Reference: literature, philosophy, film, contemporary art, academic theory, cultural movements, architectural concepts, urban studies',
  '- These should be recognizable to educated readers, but woven in with WIT and CREATIVITY',
  '- DO NOT copy examples—come up with your OWN creative, witty references',
  '- Think broadly: literary allusions, philosophical concepts, film references, art movements, cultural theory, architectural ideas',
  `- Possible sources (be creative, vary them widely): ${INTELLECTUAL_SOURCES} Vary your references and add more!`,
  '- Make references witty and contextually appropriate—they should feel natural, not forced',
  '- The goal is clever cultural commentary, not academic name-dropping',
  "- Vary your references—don't repeat the same ones in every article",
].join('\n')

const EDGE_AND_POLITICAL_INCORRECTNESS = [
  'EDGE AND POLITICAL INCORRECTNESS:',
  '- Go beyond "nice absurdity". Make readers uncomfortable. Challenge their assumptions.',
  '- Tackle taboo subjects with dark humor. Make fun of everyone equally—no sacred cows.',
  '- The goal is "I don\'t know if I should laugh" not "haha that\'s cute"',
  '- Push boundaries. Be provocative. Make people think "can they say that?"',
  '- Use dark humor, shock value, and uncomfortable truths wrapped in absurdity',
  "- Don't be mean-spirited, but don't be safe either. Make readers squirm a little.",
].join('\n')

const EDGE_SHORT = [
  'EDGE AND POLITICAL INCORRECTNESS:',
  '- Push beyond "nice absurdity". Make readers uncomfortable. Challenge assumptions.',
  '- The goal is "I don\'t know if I should laugh" not "haha that\'s cute"',
  '- Tackle taboo subjects with dark humor. Make fun of everyone equally.',
  '- Use uncomfortable truths wrapped in absurdity. Make readers squirm.',
].join('\n')

const SPICE_IT_UP = [
  'SPICE IT UP (subtle sexual innuendo):',
  '- Include 2-3 subtle double entendres or sexual innuendo that can be read innocently or suggestively',
  '- Use phrases that have a second, sexual meaning when read carefully (e.g., "penetrating the bureaucracy", "deep dive into the matter", "hard to swallow", "stiff resistance")',
  '- Keep it clever—readers should catch the double meaning',
  '- NOT explicit, NOT vulgar—just playful wordplay with sexual undertones',
].join('\n')

const WEDDING_NEIGHBORHOOD_CONTEXT = [
  'CRITICAL: "Wedding" (capitalized) refers to Wedding, a neighborhood in Berlin, NOT a wedding ceremony.',
  'DO NOT write articles about wedding ceremonies, marriage, brides, grooms, wedding planning, or wedding-related topics.',
  'The newspaper is named "The Wedding Times" because it covers the Wedding neighborhood in Berlin.',
  'When you see "Wedding" in context, it means the Berlin neighborhood (like Kreuzberg, Neukölln, Mitte, etc.), not a marriage ceremony.',
  'Write about life in the Wedding neighborhood, not about weddings as events.',
  '',
  'GENTRIFICATION CONTEXT: Wedding is experiencing massive gentrification. What was once a working-class, immigrant neighborhood is being transformed by:',
  '- Hipster cafés replacing Turkish bakeries, yoga studios where döner shops used to be',
  '- Skyrocketing rents pushing out longtime residents and Turkish families',
  '- Co-working spaces, startup offices, and "creative hubs" moving in',
  '- English menus appearing everywhere, German becoming optional',
  '- Long-time Spätis closing, replaced by organic juice bars',
  'This tension between old Wedding and new Wedding is a rich source of satire.',
].join('\n')

const WEDDING_REMINDER_SHORT = [
  'CRITICAL REMINDER: "Wedding" (capitalized) refers to Wedding, the Berlin neighborhood, NOT a wedding ceremony.',
  'DO NOT write about wedding ceremonies, marriage, brides, grooms, wedding planning, or wedding-related topics.',
  'Write about life in the Wedding neighborhood, not about weddings as events.',
].join('\n')

const TURKISH_COMMUNITY_CONTEXT = [
  "IMPORTANT CONTEXT: Wedding is a neighborhood with a significant Turkish community. This is a natural, integral part of the neighborhood's character.",
  "When writing about Wedding, it's natural and appropriate to mention Turkish businesses, Turkish families, Turkish cultural elements, Turkish-owned shops, etc.",
  'The Turkish community is fair game for satire and edgy humor—make fun of them like you make fun of everyone else. But avoid racist stereotypes, slurs, or hateful content.',
  "Turkish döner shops, Turkish families, Turkish community events, Turkish-owned businesses are all part of Wedding's reality and should be mentioned when relevant.",
  "Satirize Turkish community elements with the same edgy, politically incorrect approach you use for everything—just don't be racist about it.",
  '',
  'GENTRIFICATION vs TURKISH COMMUNITY: There is a tension between the longtime Turkish community and the gentrifying newcomers.',
  'Turkish families who have lived here for generations are being priced out by rising rents. Their döner shops and bakeries are being replaced by hipster cafés.',
  'This clash of cultures—old Wedding vs new Wedding, Turkish grandmas vs tech bros, döner vs avocado toast—is ripe for satire.',
].join('\n')

const TURKISH_REMINDER_SHORT = [
  'IMPORTANT: Wedding has a significant Turkish community. When writing about Wedding, naturally mention Turkish businesses, Turkish families, Turkish cultural elements when relevant.',
  'The Turkish community is fair game for satire—make fun of them like everyone else. But avoid racist stereotypes, slurs, or hateful content.',
].join('\n')

// Strong version - used when drugs/techno topic IS selected
const BERLIN_DRUGS_TECHNO_CULTURE_STRONG = [
  'CRITICAL BERLIN CULTURE ELEMENTS - DRUGS AND TECHNO:',
  "Berlin's identity is INSEPARABLE from its techno and drug culture. This is not optional flavor—it's the city's DNA.",
  'Your topic is about drugs/techno/nightlife, so LEAN INTO IT FULLY:',
  '- Techno clubs: Berghain, Sisyphos, About Blank, Kater Blau, Golden Gate, Kitkat, Tresor, RSO, Griessmuehle, Wilde Renate',
  '- IMPORTANT: Do NOT only mention Berghain! Vary your club references.',
  '- The door policies and bouncers as cultural gatekeepers',
  '- The legendary queues—hours of waiting, outfit anxiety, rejection trauma',
  '- Wristbands and stamps as status symbols, protected like investments',
  '- Stickers on phone cameras (no photos allowed)—the ritual of covering your lens at the door',
  '- Drug use as a normal part of Berlin nightlife (ketamine, MDMA, cocaine, speed, GHB)',
  "- Görlitzer Park as Berlin's open-air pharmacy",
  '- After-parties that last for days, the blurry line between Saturday and Tuesday',
  '- The walk of shame / stride of pride home at 2pm on a Monday',
  '- Club bathrooms as social spaces (and transaction venues), always crowded',
  '- Darkrooms, sex parties, orgies as casual weekend activities',
  "- The 'Berlin look': all black, tired, possibly still high from the weekend",
  '- Späti culture as the support system for Berlin nightlife',
  '',
  'Make drugs and techno feel as natural and present as breathing—because in Berlin, they are.',
].join('\n')

// Mild version - used when drugs/techno topic is NOT selected
const BERLIN_DRUGS_TECHNO_CULTURE_MILD = [
  'BERLIN CULTURE NOTE:',
  'Your topic is NOT about drugs/techno/nightlife, so focus on your assigned subject.',
  'Berlin has many facets beyond the club scene: bureaucracy, housing crisis, gentrification,',
  'Turkish community, neighborhood life, BVG chaos, Späti culture, crime, food, art, startups.',
  'Write about what your topic calls for—do not shoehorn clubs or drugs into unrelated stories.',
].join('\n')

const CATEGORY_MAPPING_GUIDE = [
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
].join('\n')

const OPINION_PIECE_FORMAT = [
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
].join('\n')

const JSON_SCHEMA = [
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
  '  "imagePrompt": string|null,  // REQUIRED: prompt for an illustrative photorealistic image, no text overlays. (<= 600 chars)',
  '  "sourceRssTopic": string|null  // If your article was inspired by a real news topic provided, copy the original news headline here verbatim. Otherwise null.',
  '}',
].join('\n')

const AUTHOR_SELECTION = [
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
].join('\n')

// Strong version - when drugs/techno IS selected, headlines MUST be explicit
const DRUGS_TECHNO_HEADLINES_STRONG = [
  '═══════════════════════════════════════════════════════════════════',
  'HEADLINE REQUIREMENT - EXPLICIT DRUGS/TECHNO REFERENCE MANDATORY',
  '═══════════════════════════════════════════════════════════════════',
  'Your headline MUST contain at least ONE of these explicit keywords:',
  '- Drug names: ketamine, cocaine, MDMA, speed, GHB, acid, mushrooms, weed',
  '- Drug slang: K-hole, bumps, lines, rolled, tripping, high, coming down, dealer',
  '- Club names: Berghain, Sisyphos, About Blank, Kater Blau, Kitkat, Tresor, Golden Gate, Wilde Renate',
  '- Club terms: techno, DJ, bouncer, dancefloor, darkroom, after-hours, rave',
  '- Locations: Görlitzer Park',
  '',
  'GOOD headline examples (notice the explicit drug/club references):',
  '- "Ketamine Shortage Hits Wedding: Locals Forced to Feel Feelings"',
  '- "Berghain Bouncer Starts Rating Pupils on Google Maps"',
  '- "Man Claims MDMA Cured His Fear of Bureaucracy"',
  '- "Görlitzer Park Dealer Offers Loyalty Program With Newsletter"',
  '- "Sisyphos Regular Discovers He Has Been Dancing for 72 Hours"',
  '- "Local DJ Admits He\'s Just Been Pressing Play Since 2019"',
  '',
  'BAD headlines (too subtle - REJECTED):',
  '- "Wedding Man Orders Coffee at 3pm" (no explicit drug/club reference)',
  '- "Nightlife Scene Sees Changes" (too vague)',
  '- "Berlin Party Culture Evolving" (no specific drugs or clubs)',
  '',
  'Your headline MUST be EXPLICIT. Subtle hints are NOT enough.',
  '═══════════════════════════════════════════════════════════════════',
].join('\n')

// Mild version - when drugs/techno is NOT selected
const DRUGS_TECHNO_HEADLINES_MILD = [
  'HEADLINE NOTE:',
  'Your topic is NOT about drugs/techno, so write a headline that fits your actual subject.',
  'Do not force drug or club references into unrelated stories.',
].join('\n')

const INTELLECTUAL_HEADLINE_REFERENCES = [
  'INTELLECTUAL REFERENCES IN HEADLINES (OPTIONAL BUT ENCOURAGED):',
  'Consider weaving intellectual or cultural references into your headlines when it fits naturally.',
  'This adds wit and rewards educated readers. Examples of headline styles with references:',
  '- "Local Man\'s Sisyphean Quest for Anmeldung Enters Year Four"',
  '- "Proustian Flashback Ruins Techno Set at Berghain"',
  '- "Waiting for Döner: Neukölln Man\'s Beckettian Vigil at 3am"',
  '- "Kafkaesque Bureaucracy Claims Another Victim at Bürgeramt"',
  '- "The Unbearable Lightness of Being Rejected at Berghain"',
  '- "Görlitzer Park: A Dialectical Analysis of Supply and Demand"',
  'This is a SUGGESTION, not a requirement—use when it enhances the headline without forcing it.',
].join('\n')

const IMAGE_GENERATION = [
  'IMAGE GENERATION:',
  'You MUST provide an imagePrompt for almost every article. Think: what photo would a real newspaper use to illustrate this story?',
  'The imagePrompt should be a detailed, visual description of a photorealistic image (no text overlays).',
  'Only omit imagePrompt if the story is truly unillustratable (very rare).',
].join('\n')

const IMAGE_PROMPT_INSTRUCTIONS = [
  'IMPORTANT: You MUST provide an imagePrompt for almost every article. The imagePrompt should be:',
  '- A detailed description of a photorealistic image that would illustrate the article',
  '- Specific, visual, and descriptive (e.g., "A man in a suit holding a stack of papers at a Bürgeramt counter, frustrated expression, bureaucratic setting")',
  '- No text overlays, just a visual description',
  '- Related to the main subject of the article',
  '- Think like a photojournalist: what photo would accompany this news story?',
  '- Only omit imagePrompt if the story is truly unillustratable (very rare)',
].join('\n')

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

/**
 * Analyzes recent headlines and returns a detailed breakdown of overused structural patterns.
 * This is a data-driven approach: count actual opening words/phrases and flag any that appear 2+ times.
 */
export function analyzeHeadlineStructures(titles: string[]): {
  openingWordCounts: Map<string, string[]> // opening word -> list of headlines using it
  openingPhraseCounts: Map<string, string[]> // first 2-3 words -> list of headlines using it
  overusedOpenings: string[] // opening words/phrases used 2+ times, with counts
} {
  const openingWordCounts = new Map<string, string[]>()
  const openingPhraseCounts = new Map<string, string[]>()

  for (const title of titles) {
    const words = title.split(/\s+/)
    if (words.length === 0) continue

    // Track first word (normalized to lowercase for comparison, but keep original for display)
    const firstWord = words[0].toLowerCase().replace(/[^a-z]/g, '')
    if (firstWord) {
      const existing = openingWordCounts.get(firstWord) ?? []
      existing.push(title)
      openingWordCounts.set(firstWord, existing)
    }

    // Track first 2-3 words as a phrase (for patterns like "Who keeps", "The great", etc.)
    if (words.length >= 2) {
      const twoWordPhrase = words.slice(0, 2).join(' ').toLowerCase()
      const existing2 = openingPhraseCounts.get(twoWordPhrase) ?? []
      existing2.push(title)
      openingPhraseCounts.set(twoWordPhrase, existing2)
    }

    if (words.length >= 3) {
      const threeWordPhrase = words.slice(0, 3).join(' ').toLowerCase()
      const existing3 = openingPhraseCounts.get(threeWordPhrase) ?? []
      existing3.push(title)
      openingPhraseCounts.set(threeWordPhrase, existing3)
    }
  }

  // Find overused patterns (2+ occurrences)
  const overusedOpenings: string[] = []

  // Check opening words
  for (const [word, headlines] of openingWordCounts) {
    if (headlines.length >= 2) {
      overusedOpenings.push(
        `"${word.charAt(0).toUpperCase() + word.slice(1)}..." (${headlines.length} headlines start with this word)`,
      )
    }
  }

  // Check opening phrases (only add if not already covered by single word)
  for (const [phrase, headlines] of openingPhraseCounts) {
    if (headlines.length >= 2) {
      const firstWord = phrase.split(' ')[0]
      // Only add phrase if it's more specific than just the first word
      const firstWordCount = openingWordCounts.get(firstWord)?.length ?? 0
      if (headlines.length < firstWordCount) {
        // This phrase is a more specific subset, worth mentioning
        overusedOpenings.push(
          `"${phrase
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')}..." (${headlines.length} headlines)`,
        )
      }
    }
  }

  return { openingWordCounts, openingPhraseCounts, overusedOpenings }
}

// Legacy function for backward compatibility
export function extractHeadlinePatterns(titles: string[]): string[] {
  const { overusedOpenings } = analyzeHeadlineStructures(titles)
  return overusedOpenings
}

/**
 * Extracts significant keywords from headlines and identifies overused ones.
 * Filters out stopwords to focus on meaningful content words (nouns, verbs, adjectives).
 */
export function extractOverusedKeywords(titles: string[]): {
  keywordCounts: Map<string, number>
  bannedKeywords: string[] // Keywords appearing 2+ times
} {
  // Common stopwords to filter out (articles, pronouns, prepositions, conjunctions, etc.)
  const stopwords = new Set([
    // Articles
    'a',
    'an',
    'the',
    // Pronouns
    'i',
    'me',
    'my',
    'myself',
    'we',
    'our',
    'ours',
    'ourselves',
    'you',
    'your',
    'yours',
    'yourself',
    'yourselves',
    'he',
    'him',
    'his',
    'himself',
    'she',
    'her',
    'hers',
    'herself',
    'it',
    'its',
    'itself',
    'they',
    'them',
    'their',
    'theirs',
    'themselves',
    'what',
    'which',
    'who',
    'whom',
    'this',
    'that',
    'these',
    'those',
    // Prepositions
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'from',
    'up',
    'about',
    'into',
    'over',
    'after',
    'beneath',
    'under',
    'above',
    'between',
    'through',
    'during',
    'before',
    'behind',
    'below',
    'against',
    'among',
    'throughout',
    'despite',
    'towards',
    'upon',
    'concerning',
    'without',
    'within',
    'along',
    'following',
    'across',
    'beyond',
    // Conjunctions
    'and',
    'but',
    'or',
    'nor',
    'for',
    'yet',
    'so',
    'because',
    'although',
    'while',
    'if',
    'when',
    'where',
    'unless',
    'until',
    'since',
    'as',
    'than',
    'whether',
    // Common verbs (auxiliary/modal)
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'having',
    'do',
    'does',
    'did',
    'doing',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'shall',
    'can',
    'need',
    'dare',
    'ought',
    'used',
    'go',
    'goes',
    'gone',
    'going',
    'get',
    'gets',
    'got',
    'getting',
    'make',
    'makes',
    'made',
    'making',
    'say',
    'says',
    'said',
    'saying',
    'see',
    'sees',
    'saw',
    'seen',
    'seeing',
    // Common adverbs
    'not',
    'only',
    'just',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'nor',
    'too',
    'very',
    'also',
    'back',
    'even',
    'still',
    'well',
    'here',
    'there',
    'now',
    'then',
    'once',
    'never',
    'always',
    'often',
    'ever',
    'almost',
    'already',
    'soon',
    // Common adjectives
    'new',
    'first',
    'last',
    'long',
    'great',
    'little',
    'own',
    'old',
    'right',
    'big',
    'high',
    'different',
    'small',
    'large',
    'next',
    'early',
    'young',
    'important',
    'few',
    'public',
    'bad',
    'same',
    'able',
    'own',
    'best',
    'better',
    'sure',
    'free',
    // Numbers and quantifiers
    'one',
    'two',
    'three',
    'four',
    'five',
    'all',
    'each',
    'every',
    'both',
    'many',
    'much',
    'any',
    'another',
    'several',
    'enough',
    'most',
    'least',
    'less',
    'more',
    // Other common words
    'like',
    'way',
    'thing',
    'things',
    'time',
    'times',
    'year',
    'years',
    'day',
    'days',
    'man',
    'men',
    'woman',
    'women',
    'people',
    'part',
    'place',
    'case',
    'week',
    'weeks',
    'point',
    'fact',
    'hand',
    'world',
    'life',
    'work',
    'home',
    'night',
    'month',
    // Article-specific but too common
    'local',
    'berlin',
    'berlins',
    'wedding',
    'says',
    'after',
    'why',
    'how',
    'out',
  ])

  const keywordCounts = new Map<string, number>()

  for (const title of titles) {
    // Extract words, normalize to lowercase, remove punctuation
    const words = title
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9äöüß-]/g, ''))
      .filter((word) => word.length >= 3) // Minimum 3 characters to catch GHB, LSD, etc.
      .filter((word) => !stopwords.has(word))

    // Count each unique word per title (to avoid counting duplicates within same title)
    const uniqueWords = new Set(words)
    for (const word of uniqueWords) {
      keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1)
    }
  }

  // Find keywords appearing 2+ times
  const bannedKeywords: string[] = []
  for (const [keyword, count] of keywordCounts) {
    if (count >= 2) {
      bannedKeywords.push(keyword)
    }
  }

  return { keywordCounts, bannedKeywords }
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

/******************* HEADLINE REGENERATION ***********************/

/**
 * Regenerates ONLY the headline when it violates banned opening word rules.
 * This is more efficient than regenerating the entire article.
 */
async function regenerateHeadline(args: {
  article: GeneratedArticle
  bannedOpeningWords: string[]
  recentTitles: string[]
}): Promise<GeneratedArticle> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const repairModelName = process.env.OPENAI_REPAIR_MODEL ?? 'gpt-4o-mini'

  const llm = new ChatOpenAI({
    apiKey,
    model: repairModelName,
    temperature: 1.7, // crazy creative  // Some creativity but more controlled
  })

  const bannedWordsLower = args.bannedOpeningWords.map((w) => w.toLowerCase())
  const currentFirstWord =
    args.article.headline
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? ''

  const systemPrompt = [
    'You are a headline editor for a satirical newspaper.',
    'Your ONLY job is to rewrite a headline that violates structural rules.',
    'You must preserve the meaning and tone but change the STRUCTURE (especially the opening word).',
    '',
    'Output ONLY the new headline as plain text. No JSON, no quotes, no explanation.',
    'The headline must be <= 140 characters.',
  ].join('\n')

  const userPrompt = [
    'PROBLEM: The following headline starts with a BANNED word that is overused in recent articles.',
    '',
    `Current headline: "${args.article.headline}"`,
    `Banned opening word: "${currentFirstWord}" (this word starts too many recent headlines)`,
    '',
    'ALL BANNED OPENING WORDS (do NOT start with ANY of these):',
    args.bannedOpeningWords.map((w) => `  ❌ "${w}..."`).join('\n'),
    '',
    'Recent headlines for context (yours must be STRUCTURALLY different):',
    args.recentTitles
      .slice(0, 10)
      .map((t, i) => `  ${i + 1}. ${t}`)
      .join('\n'),
    '',
    'Article context (to preserve meaning):',
    `- Subheadline: ${args.article.subheadline ?? 'N/A'}`,
    `- Excerpt: ${args.article.excerpt ?? 'N/A'}`,
    '',
    'REWRITE the headline with a DIFFERENT opening structure.',
    'Some alternatives:',
    '- Start with a proper noun/name: "Klaus Müller Discovers..."',
    '- Start with a location: "In Wedding...", "At Leopoldplatz..."',
    '- Start with a number: "47 Bikes...", "Three Days After..."',
    '- Start with a verb: "Forget Everything...", "Meet the..."',
    '- Start with an adjective: "Desperate...", "Mysterious..."',
    '- Use quotation: ""I Regret Nothing," Says..."',
    '',
    'Output ONLY the new headline (no quotes, no explanation):',
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const newHeadline = (typeof raw.content === 'string' ? raw.content : String(raw.content))
    .trim()
    .replace(/^["']|["']$/g, '') // Remove surrounding quotes if any
    .slice(0, 140) // Enforce max length

  // Verify the new headline doesn't also start with a banned word
  const newFirstWord =
    newHeadline
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? ''
  if (bannedWordsLower.includes(newFirstWord)) {
    // If still banned, try one more time with even stronger instruction
    const retryPrompt = [
      `The headline "${newHeadline}" STILL starts with a banned word "${newFirstWord}".`,
      '',
      'ABSOLUTELY FORBIDDEN opening words:',
      args.bannedOpeningWords.map((w) => `  ❌ "${w}"`).join('\n'),
      '',
      'Write a headline that starts with a COMPLETELY DIFFERENT word.',
      'Try: a name, a number, a location, an adjective, or a quoted statement.',
      '',
      'Output ONLY the new headline:',
    ].join('\n')

    const retryRaw = await llm.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: retryPrompt },
    ])

    const retryHeadline = (
      typeof retryRaw.content === 'string' ? retryRaw.content : String(retryRaw.content)
    )
      .trim()
      .replace(/^["']|["']$/g, '')
      .slice(0, 140)

    return { ...args.article, headline: retryHeadline }
  }

  return { ...args.article, headline: newHeadline }
}

/**
 * Checks if a headline starts with a banned opening word.
 */
function headlineViolatesBannedWords(headline: string, bannedOpeningWords: string[]): boolean {
  if (bannedOpeningWords.length === 0) return false
  const firstWord =
    headline
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? ''
  const bannedLower = bannedOpeningWords.map((w) => w.toLowerCase())
  return bannedLower.includes(firstWord)
}

/******************* MAIN ***********************/

export async function generateArticle(input: GenerateArticleInput): Promise<GenerateArticleResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const modelName = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

  const llm = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 1.7, // crazy creative
  })

  // 33% chance to use the new feature/soft news/local/crime/news story prompt type
  // When forceRss is true, skip feature story to ensure RSS topic is used
  const useFeatureStoryPrompt = input.forceRss ? false : Math.random() < 0.33

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
    // Drugs & Techno stories - Berlin's famous underground culture
    'A Berghain bouncer has started a side business rating peoples pupils before they even reach the door',
    'Görlitzer Park dealer introduces subscription model with loyalty points and a newsletter',
    'Man has been on the same ketamine trip since 2019, friends unsure if he knows the pandemic happened',
    'New study finds 87% of Berlin techno DJs are just pressing play and checking their phones',
    'Kreuzberg man realizes his entire personality is just the drugs he did in his 20s',
    'Local club introduces "sober corner" but nobody can find it because they are not sober',
    'Woman discovers her entire friend group only exists inside About Blank, has never seen them in daylight',
    'After-hours club in Neukölln has been going for 6 days straight, original patrons have evolved',
    'Berlin techno scene mourns as someone turned on the lights too early',
    'Man at Sisyphos has been dancing to the same loop for 14 hours, claims "the drop is coming"',
    'New artisanal cocaine dealer in Prenzlauer Berg offers organic, fair-trade product for 30% markup',
    'Kater Blau door policy now includes written exam on the history of ambient techno',
    'Local ketamine enthusiast becomes so disassociated he accidentally fixes his life',
    'Wedding Späti now offers drug testing services alongside energy drinks and tobacco',
    'Man who peaked in 2012 Golden Gate era still dresses like it, friends concerned but also jealous',
    'Berlin health officials report surge in people claiming techno cured their depression (it did not)',
    'New app matches you with compatible drug dealers based on your music taste and credit score',
    'The great Berlin speed shortage of 2026: DJs forced to play at normal BPM',
    'Techno purist outraged that About Blank plays songs with "too many melodies"',
    'Man has perfected the art of looking like hes on drugs when hes actually just tired and German',
    'Darkroom etiquette workshop at Kitkat sells out, attendees learn proper queuing technique',
    'Görlitzer Park nominated for UNESCO cultural heritage site for its thriving pharmaceutical ecosystem',
    'Berlin club kid realizes hes been going to Wilde Renate for 8 years with only bathroom breaks',
    'New documentary follows the lives of cigarettes at Sisyphos from pocket to floor to stepped on',
    'About Blank garden party enters day 4, original attendees have formed their own micro-society',
    'Tresor basement so hot that sweat has formed its own weather system',
    'Golden Gate sunrise session accidentally continues until the next sunrise',
    'Kater Blau floating platform detaches, attendees unbothered, continue dancing toward Poland',
  ]

  // DRUGS AND TECHNO BIAS: 50% chance to pick from drugs/techno scenarios specifically
  const drugsAndTechnoScenarios = concreteBerlinScenarios.filter(
    (scenario) =>
      scenario.includes('Berghain') ||
      scenario.includes('ketamine') ||
      scenario.includes('drug') ||
      scenario.includes('techno') ||
      scenario.includes('club') ||
      scenario.includes('DJ') ||
      scenario.includes('dealer') ||
      scenario.includes('Görlitzer') ||
      scenario.includes('dancing') ||
      scenario.includes('trip') ||
      scenario.includes('cocaine') ||
      scenario.includes('Sisyphos') ||
      scenario.includes('Kitkat') ||
      scenario.includes('after-hours') ||
      scenario.includes('darkroom') ||
      scenario.includes('sober') ||
      scenario.includes('high') ||
      scenario.includes('pupils'),
  )

  // 35% chance to select from drugs/techno scenarios, 65% from NON-drugs/techno scenarios
  // Can be overridden by forceDrugsTechno parameter for variety control
  const useDrugsOrTechnoScenario =
    input.forceDrugsTechno !== undefined ? input.forceDrugsTechno : Math.random() < 0.35

  // Filter OUT drugs/techno scenarios for the general pool
  const nonDrugsTechnoScenarios = concreteBerlinScenarios.filter(
    (scenario) => !drugsAndTechnoScenarios.includes(scenario),
  )

  const selectedScenario = useDrugsOrTechnoScenario
    ? drugsAndTechnoScenarios[Math.floor(Math.random() * drugsAndTechnoScenarios.length)]
    : nonDrugsTechnoScenarios[Math.floor(Math.random() * nonDrugsTechnoScenarios.length)]

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
    // Nightlife - the real reason people move to Berlin
    'Berlin techno clubs, Berghain door policy, or nightlife culture',
    'after-hours clubs, sunrise sessions, or the walk of shame home',
    'the desperate measures people take to get into Berghain',
    'club bathroom hookups, darkroom etiquette, or fetish night mishaps',
    'the Berghain queue as a competitive sport and personality test',
    'what your club outfit says about you (usually: trying too hard)',
    'the hierarchy of Berlin clubs: from Berghain to "that weird basement thing"',
    'people who claim they "never go out anymore" but are spotted at Sisyphos every weekend',
    'the economics of club stamps: why people protect them like investments',
    'Berlin nightlife as the only valid form of exercise',
    'the unspoken rules of the club smoking area: therapys cheaper here',
    'when the afters are better than the party, which happens to be your entire social life now',
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
    // Techno - Berlin's beating heart (literally, 130 BPM)
    'Berlin techno scene, DJ drama, or warehouse rave culture',
    'Berghain rejection stories, club outfit disasters, or bouncer psychology',
    'washed-up DJs clinging to relevance, or techno bro philosophy',
    'the Berghain door as Berlins most important cultural institution',
    'techno tourists ruining the atmosphere by trying too hard',
    'people who peaked in 2010s Berlin clubbing and refuse to move on',
    'the sociology of club queues: who deserves entry and why not you',
    'DJs who think pressing play makes them artists',
    'the death of Berlin club culture, killed by Instagram and tourists',
    'techno as a religion with its own temples and rituals',
    'why every DJ in Berlin has a SoundCloud but no healthcare',
    'the techno-to-tech pipeline: former DJs now work in startups',
    'after-hours clubs where time, hygiene, and social norms dont exist',
    'the Berlin club kids aesthetic: looking homeless but on purpose',
    'warehouse raves that definitely violate fire codes',
    'the unwritten rules of Berlin dancefloors: no phones, no talking, no joy',
    'techno purists who think anything with melody is selling out',
    'the Sisyphos experience: entering Saturday, leaving Tuesday, forgetting your name',
    'Berlin DJs explaining why their 4-hour set of the same beat is art',
    'Kitkat dress code: the only place where nudity is the conservative option',
    'the parallel economy of Berlin club wristbands and stamps',
    'About Blank garden parties that turn into 3-day odysseys',
    'Kater Blau: where the river meets the rave and nobody knows what day it is',
    'Golden Gate at 6am: where the weekend truly begins or ends, unclear which',
    'the Wilde Renate labyrinth: people have been lost in there since 2012',
    'Tresor basement: dancing in what used to be a bank vault, now a sweat vault',
    'RSO and the industrial techno scene that makes Berghain look mainstream',
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
    // Drugs - expanded (Berlin's most important cultural export)
    'ketamine as a personality substitute in Berlin',
    'the dealer hierarchy at Görlitzer Park, or drug tourism',
    'microdosing tech bros who think LSD makes them Steve Jobs',
    'people who base their entire identity around doing MDMA',
    'the cocaine-to-meditation pipeline of Berlin wellness culture',
    'speed as the unofficial currency of Berlin nightlife',
    'GHB mishaps and the fine line between party and ambulance',
    'drug dealers with better customer service than Deutsche Bahn',
    'the gentrification of drug culture—artisanal cocaine and organic weed',
    'the Görlitzer Park pharmaceutical ecosystem and its surprisingly organized structure',
    'ketamine holes as a form of meditation accepted by Berlin health insurance',
    'the unwritten rules of club bathroom transactions',
    'how to tell if someone is on drugs in Berlin (trick question: everyone is)',
    'the Berlin drug brunch: mimosas are out, bumps are in',
    'when your dealer has better work-life balance than you',
    'the art of pretending to be sober at Sunday brunch after a 3-day bender',
    'the economics of Berlin drug culture: why dealers accept Paypal now',
    'tourists trying to buy drugs in Berlin and ending up with oregano',
    'the gentrification of drug dealing: dealers now have personal brands',
    'Berlin parents explaining to their kids why that man is selling oregano in the park',
    'the unofficial drug menu at every Berlin Späti',
    'speed-induced apartment cleaning at 4am: Berlins most productive hours',
    'why Berlin clubs have the cleanest bathroom floors (they dont)',
    'the Berlin ketamine to therapy pipeline: dissociate first, process later',
    // Decadence - expanded (Berlin's default state)
    'sex parties marketed as "networking events"',
    'the three-day bender that turned into a lifestyle',
    'KitKat dress codes and the nudity-as-personality phenomenon',
    'people who havent seen daylight since 2019',
    'the Berlin tradition of turning every brunch into day drinking',
    'after-hour clubs where time has no meaning and neither does hygiene',
    'orgies disguised as art installations',
    'the dark tourist economy of Berlin hedonism',
    'people whose only accomplishment is attending every Berghain opening',
    'the fine line between "living your best life" and "needing intervention"',
    'when your Tuesday is someone elses Saturday and you genuinely forgot what day it is',
    'the unwritten Berlin rule that you can do anything as long as you say its art',
    'Berlins approach to self-care: destruction before reconstruction',
    'people whose entire social life happens between 2am and 8am',
    'the Berlin sleep schedule: optional, flexible, theoretical',
    'how to explain your lifestyle to your parents without using the words drugs, orgy, or unemployed',
    'the economics of hedonism: how to party 5 days a week on a freelancer budget',
    'Berlins parallel universe where going home before sunrise is considered rude',
    'the walk of shame that became the stride of pride that became the Tuesday commute',
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

  // DRUGS AND TECHNO BIAS: 50% chance to pick from drugs/techno/nightlife/decadence topics specifically
  // This ensures Berlin's most iconic cultural elements appear frequently
  const drugsAndTechnoTopics = topicFocuses.filter(
    (topic) =>
      topic.includes('drug') ||
      topic.includes('ketamine') ||
      topic.includes('cocaine') ||
      topic.includes('MDMA') ||
      topic.includes('speed') ||
      topic.includes('GHB') ||
      topic.includes('LSD') ||
      topic.includes('techno') ||
      topic.includes('Berghain') ||
      topic.includes('club') ||
      topic.includes('DJ') ||
      topic.includes('rave') ||
      topic.includes('nightlife') ||
      topic.includes('after-hour') ||
      topic.includes('Kitkat') ||
      topic.includes('Sisyphos') ||
      topic.includes('decadence') ||
      topic.includes('bender') ||
      topic.includes('sex part') ||
      topic.includes('orgi') ||
      topic.includes('hedonism') ||
      topic.includes('Görlitzer Park') ||
      topic.includes('dealer'),
  )

  // 35% chance to select from drugs/techno topics, 65% from NON-drugs/techno topics
  // Can be overridden by forceDrugsTechno parameter for variety control
  const useDrugsOrTechnoTopic =
    input.forceDrugsTechno !== undefined ? input.forceDrugsTechno : Math.random() < 0.35

  // Filter OUT drugs/techno topics for the general pool to prevent double-dipping
  const nonDrugsTechnoTopics = topicFocuses.filter((topic) => !drugsAndTechnoTopics.includes(topic))

  let randomFocus: string

  if (useDrugsOrTechnoTopic) {
    randomFocus = drugsAndTechnoTopics[Math.floor(Math.random() * drugsAndTechnoTopics.length)]
  } else {
    // If NOT about drugs/techno, 30% chance to pick startup/gentrification topics
    const startupAndGentrificationTopics = nonDrugsTechnoTopics.filter(
      (topic) =>
        topic.includes('startup') ||
        topic.includes('tech bro') ||
        topic.includes('co-working') ||
        topic.includes('WeWork') ||
        topic.includes('venture capital') ||
        topic.includes('crypto startup') ||
        topic.includes('entrepreneur') ||
        topic.includes('disruptive') ||
        topic.includes('pitch night') ||
        topic.includes('side hustle') ||
        topic.includes('gentrification') ||
        topic.includes('yoga') ||
        topic.includes('vegan') ||
        topic.includes('mindfulness') ||
        topic.includes('wellness') ||
        topic.includes('expat'),
    )

    const useStartupTopic = Math.random() < 0.3
    randomFocus =
      useStartupTopic && startupAndGentrificationTopics.length > 0
        ? startupAndGentrificationTopics[
            Math.floor(Math.random() * startupAndGentrificationTopics.length)
          ]
        : nonDrugsTechnoTopics[Math.floor(Math.random() * nonDrugsTechnoTopics.length)]
  }

  // When RSS topics are available, pick one to base the article on
  const rssTopics = input.topicSummary
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
  const hasRssTopics = input.includeTopics && rssTopics.length > 0
  const selectedRssTopic = hasRssTopics
    ? rssTopics[Math.floor(Math.random() * rssTopics.length)]
    : null

  // Track whether RSS topic was ACTUALLY used in the prompt (not just selected)
  // RSS topics are only used when NOT a feature story AND RSS topics are available
  const actuallyUsedRssTopic =
    !useFeatureStoryPrompt && hasRssTopics && selectedRssTopic ? selectedRssTopic : null

  // Limit to 12 most recent articles to keep token usage reasonable
  const maxRecentArticles = 12
  const recentTitles = input.recentArticleTitles.slice(0, maxRecentArticles)
  const recentExcerpts = input.recentArticleExcerpts?.slice(0, maxRecentArticles) ?? []

  const recentTitlesSection =
    recentTitles.length > 0
      ? [
          `\nCRITICAL: DO NOT repeat these recent article topics (${recentTitles.length} recent articles shown to avoid repetition):`,
          recentTitles
            .map((title, idx) => {
              const excerpt = recentExcerpts[idx]
              const excerptText = excerpt
                ? ` - ${excerpt.length > 150 ? excerpt.slice(0, 147) + '...' : excerpt}`
                : ''
              return `${idx + 1}. "${title}"${excerptText}`
            })
            .join('\n'),
          '',
          'You must write about a COMPLETELY DIFFERENT topic/subject matter. Do not write about similar themes, similar situations, or similar characters.',
          'If you see multiple articles about bureaucracy, write about something else entirely. If you see multiple articles about nightlife, choose a different angle.',
          'The excerpts above show the actual content/story angle—avoid repeating these specific story ideas, not just the topics.',
          '',
        ].join('\n')
      : ''

  // Section showing the latest article's content to ensure the new one is different
  const latestArticleSection = input.latestArticleContentSample
    ? [
        '',
        '═══════════════════════════════════════════════════════════════════',
        'CRITICAL: YOUR ARTICLE MUST BE DIFFERENT FROM THE LATEST ONE',
        '═══════════════════════════════════════════════════════════════════',
        '',
        'Below is a sample from the MOST RECENT article published. Your new article MUST be distinctly different:',
        '- Different topic/subject matter',
        '- Different tone and approach',
        '- Different story structure',
        '- Different characters/situations',
        '',
        'LATEST ARTICLE CONTENT SAMPLE (DO NOT write something similar):',
        '---',
        input.latestArticleContentSample,
        '---',
        '',
        'Write something FRESH and ORIGINAL that contrasts with the above.',
        '═══════════════════════════════════════════════════════════════════',
      ].join('\n')
    : ''

  // Analyze headline structures to find overused patterns (data-driven approach)
  const headlineAnalysis = analyzeHeadlineStructures(input.recentArticleTitles)
  const overusedOpenings = headlineAnalysis.overusedOpenings

  // Build a list of BANNED opening words (any word used 2+ times)
  const bannedOpeningWords: string[] = []
  for (const [word, headlines] of headlineAnalysis.openingWordCounts) {
    if (headlines.length >= 2) {
      bannedOpeningWords.push(word.charAt(0).toUpperCase() + word.slice(1))
    }
  }

  // Extract overused keywords (nouns, verbs, adjectives) from recent titles
  const keywordAnalysis = extractOverusedKeywords(input.recentArticleTitles)
  const bannedKeywords = keywordAnalysis.bannedKeywords

  const headlinePatternsSection =
    overusedOpenings.length > 0
      ? [
          '',
          '═══════════════════════════════════════════════════════════════════',
          'CRITICAL: HEADLINE STRUCTURE VARIETY REQUIRED',
          '═══════════════════════════════════════════════════════════════════',
          '',
          'OVERUSED HEADLINE OPENINGS DETECTED (you MUST NOT use these):',
          overusedOpenings.map((p) => `  ❌ ${p}`).join('\n'),
          '',
          bannedOpeningWords.length > 0
            ? [
                'BANNED OPENING WORDS (DO NOT start your headline with ANY of these):',
                bannedOpeningWords.map((w) => `  ❌ "${w}..."`).join('\n'),
                '',
                'This is NOT a suggestion. If your headline starts with any of the banned words above, it will be REJECTED.',
                'You MUST choose a DIFFERENT opening word that is NOT in this list.',
              ].join('\n')
            : '',
          '',
          'WHY THIS MATTERS:',
          'Headlines that start the same way create monotony. Readers notice when multiple headlines',
          'start with "Who...", "The...", "How...", etc. Each headline must feel FRESH and DIFFERENT.',
          '',
          'WHAT TO DO INSTEAD:',
          'Look at the banned words above and deliberately choose a DIFFERENT structure.',
          'Some alternatives (only use if not already banned above):',
          '- Start with a proper noun/name: "Klaus Müller Discovers...", "Leopoldplatz Residents..."',
          '- Start with a number: "47 Bikes Vanish...", "Three Years Later..."',
          '- Start with a location: "In Wedding...", "At Leopoldplatz..."',
          '- Start with a verb (imperative): "Forget Everything...", "Meet the Man..."',
          '- Start with an adjective: "Desperate Späti Owner...", "Mysterious Note..."',
          '- Start with a time reference: "After 3 Years...", "Since Tuesday..."',
          '- Use quotation: ""I Regret Nothing," Says...", ""This Is Normal," Claims..."',
          '',
          'REMEMBER: Check the banned list above. If "The" is banned, do NOT start with "The".',
          'If "Who" is banned, do NOT start with "Who". Choose something ELSE.',
          '═══════════════════════════════════════════════════════════════════',
        ].join('\n')
      : ''

  // Create banned keywords section (prevents repeating specific words like "MDMA", "ketamine", etc.)
  const bannedKeywordsSection =
    bannedKeywords.length > 0
      ? [
          '',
          '═══════════════════════════════════════════════════════════════════',
          'CRITICAL: BANNED KEYWORDS - DO NOT USE THESE WORDS',
          '═══════════════════════════════════════════════════════════════════',
          '',
          'The following keywords appear too frequently in recent articles.',
          'You MUST NOT use any of these words in your headline OR as a main topic:',
          '',
          bannedKeywords.map((k) => `  ❌ "${k}"`).join('\n'),
          '',
          'This is NOT a suggestion. Articles using these keywords will feel repetitive.',
          'Choose COMPLETELY DIFFERENT subjects, locations, or themes.',
          '',
          'BE CREATIVE. There are infinite Berlin stories to tell beyond these recently overused words.',
          '═══════════════════════════════════════════════════════════════════',
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
    WEDDING_NEIGHBORHOOD_CONTEXT,
    '',
    TURKISH_COMMUNITY_CONTEXT,
    '',
    // Use strong drugs/techno encouragement when that topic is selected, mild version otherwise
    useDrugsOrTechnoTopic || useDrugsOrTechnoScenario
      ? BERLIN_DRUGS_TECHNO_CULTURE_STRONG
      : BERLIN_DRUGS_TECHNO_CULTURE_MILD,
    '',
    'WRITING STYLE NOTE:',
    '- Reduce usage of the word "vibes" or "vibe"—it is overused. Prefer more specific, evocative language.',
    '- Instead of "the vibe was off", try "the atmosphere felt wrong", "something was different", "the energy had shifted", etc.',
    '',
    useFeatureStoryPrompt
      ? [
          'Tone: Deadpan, serious journalism about absurd situations, but with an edge. Write with the straight-faced seriousness of a real news reporter covering something completely ridiculous, but push boundaries. The humor comes from the contrast between the serious tone and the absurd content, but also from making readers uncomfortable—they should think "I don\'t know if I should laugh at this".',
          'Style: Write like a real local newspaper journalist—specific, detailed, factual-sounding but about something surreal. Include concrete details: names, addresses, times, quotes. Make it read like a real news article from a serious paper, but the story is absurd AND edgy. Challenge comfort zones. Make readers question their own reactions.',
          'CRITICAL: This must be CONCRETE and SPECIFIC. No abstract concepts. Real names (fictional), real addresses, real times, real quotes. The absurdity is in the situation, not in abstract satire. But push it further—make it uncomfortable, politically incorrect, challenging.',
          '',
          EDGE_AND_POLITICAL_INCORRECTNESS,
          '',
          SPICE_IT_UP,
          '',
          INTELLECTUAL_EASTER_EGGS,
        ].join('\n')
      : [
          'Tone: irreverent, subversive, and unapologetically politically incorrect. Channel the spirit of early South Park, Anthony Jeselnik, and classic British satire like Brass Eye. Mock sacred cows, poke fun at every demographic equally, and embrace taboo topics with gleeful abandon. Use dark humor, shock value, and absurdist takes on sensitive subjects. Nothing is off-limits except actual hate speech or calls to violence.',
          'Style: write like a hungover journalist who has stopped caring about keeping their job—biting sarcasm, cynical observations, and jokes that make readers say "they cant print that".',
          '',
          EDGE_AND_POLITICAL_INCORRECTNESS,
          '',
          SPICE_IT_UP,
          '',
          INTELLECTUAL_EASTER_EGGS,
        ].join('\n'),
    topicInstruction,
    recentTitlesSection,
    latestArticleSection,
    headlinePatternsSection,
    bannedKeywordsSection,
    'CRITICAL: Pick a categorySlug that BEST matches your assigned topic direction above.',
    CATEGORY_MAPPING_GUIDE,
    '',
    OPINION_PIECE_FORMAT,
    '',
    'Remember: punch in all directions, mock everyone, but avoid slurs or explicit calls for harm.',
    '',
    IMAGE_GENERATION,
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
        '- The article should be approximately 400 words of detailed, specific reporting',
        '- MUST provide an imagePrompt: describe a photorealistic photo that would illustrate this news story',
        '',
        EDGE_SHORT,
        '',
        WEDDING_REMINDER_SHORT,
        '',
        TURKISH_REMINDER_SHORT,
        '',
        'TONE: Deadpan, serious journalism about something completely ridiculous, but with an edge. Like The Onion but more detailed, specific, AND uncomfortable.',
        'STYLE: Read like a real local newspaper article. Who, what, where, when, why, how - all answered with absurd but specific details.',
        '',
        INTELLECTUAL_EASTER_EGGS,
        '',
      ].join('\n')
    : hasRssTopics && selectedRssTopic
      ? [
          'CURRENT NEWS TOPIC TO SATIRIZE:',
          selectedRssTopic,
          '',
          // When drugs/techno is selected, add the required angle
          useDrugsOrTechnoTopic
            ? [
                '═══════════════════════════════════════════════════════════════════',
                'REQUIRED ANGLE - DRUGS/TECHNO/NIGHTLIFE:',
                randomFocus,
                '',
                'You MUST connect this news topic to Berlin drugs/techno/nightlife culture.',
                'Find a way to tie the news story to clubs, drugs, DJs, Berghain, Sisyphos, after-parties, dealers, ketamine, etc.',
                'The drugs/techno angle is MANDATORY - do not write a generic Berlin article.',
                '═══════════════════════════════════════════════════════════════════',
                '',
              ].join('\n')
            : '',
          'CRITICAL INSTRUCTION: You MUST write a satirical article that connects this real-world news topic to Berlin.',
          'Take the essence/theme of this news story and write about how it manifests in Berlin, the Wedding neighborhood, or the Berlin expat/local scene.',
          'REMINDER: "Wedding" refers to the Berlin neighborhood, NOT wedding ceremonies. Do NOT write about weddings, marriage, or wedding-related topics.',
          'Examples of how to connect:',
          useDrugsOrTechnoTopic
            ? '- Connect to clubs, DJs, drug culture, after-parties, Berghain queues, dealer economics, ketamine therapy, etc.'
            : '- If the news is about a tech company layoff, write about how Berlin startups are affected or how laid-off tech bros are now DJing',
          '- If the news is about politics, write about how Berliners react to it at their local Späti or how it affects the bureaucracy',
          '- If the news is about climate, write about Berlin climate activists or how Berliners are coping',
          '- If the news is about economy/inflation, write about Berlin rent, döner prices, or club entry fees',
          '',
          'The connection to the real news should be CLEAR in the article, not just vaguely inspired.',
          'Your satirical angle should make fun of both the news topic AND Berlin culture simultaneously.',
          '',
          'IMPORTANT: Since you are using this news topic, you MUST set "sourceRssTopic" in your JSON output to the EXACT news headline above.',
          `Copy this verbatim: "${selectedRssTopic}"`,
          '',
        ].join('\n')
      : [
          'TOPIC DIRECTION FOR THIS ARTICLE:',
          randomFocus,
          '',
          'You MUST write an article about this specific topic. Do not ignore it.',
          'This is your PRIMARY directive - the article must be clearly about this topic.',
        ].join('\n')

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
          SPICE_IT_UP,
          '',
          INTELLECTUAL_EASTER_EGGS,
          '',
        ].join('\n')
      : '',
    AUTHOR_SELECTION,
    '',
    'Return an article that could plausibly run on the front page of a satirical local paper.',
    '',
    WEDDING_REMINDER_SHORT,
    '',
    TURKISH_REMINDER_SHORT,
    '',
    !useFeatureStoryPrompt
      ? [EDGE_SHORT, '', SPICE_IT_UP, '', INTELLECTUAL_EASTER_EGGS, ''].join('\n')
      : '',
    // Use strong headline guidance when drugs/techno is selected, mild otherwise
    useDrugsOrTechnoTopic || useDrugsOrTechnoScenario
      ? DRUGS_TECHNO_HEADLINES_STRONG
      : DRUGS_TECHNO_HEADLINES_MILD,
    '',
    'HEADLINE VARIETY IS CRITICAL:',
    useFeatureStoryPrompt
      ? [
          'For feature/news stories, use traditional news headline formats:',
          '- Direct, factual-sounding headlines that match your assigned topic',
          '- Question format: "Why Did [Subject] Do [Action]?"',
          '- Descriptive: "The Great [Event]: [Consequence]"',
          '- Keep it news-like but absurd, matching your specific topic',
        ].join('\n')
      : [
          'Your headline structure must be creative and varied. Avoid repetitive patterns like "Berlin [verb] [noun]".',
          'Use different structures: questions, character-focused, descriptive, comparisons, direct statements, narratives, etc.',
          'Think like a real newspaper: headlines should grab attention with wit, not formula.',
          'Match your headline to your assigned topic—do not force unrelated themes into it.',
        ].join('\n'),
    '',
    INTELLECTUAL_HEADLINE_REFERENCES,
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
    JSON_SCHEMA,
    '',
    IMAGE_PROMPT_INSTRUCTIONS,
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
      const repaired = await repairToSchema({
        badOutput: text,
        categories: input.categories,
        authors: input.authors,
        validationErrors: validation.error.issues,
      })
      return {
        article: repaired,
        usedRssTopic: actuallyUsedRssTopic,
        usedDrugsTechno: useDrugsOrTechnoTopic || useDrugsOrTechnoScenario,
      }
    }
    let validated = validation.data
    const langSample =
      `${validated.headline}\n${validated.subheadline ?? ''}\n${validated.bodyMarkdown}`.slice(
        0,
        1200,
      )
    const nonEnglish = looksNonEnglish(langSample)

    if (nonEnglish) {
      validated = await translateToEnglish({
        bad: validated,
        categories: input.categories,
        authors: input.authors,
      })
    }

    // Check if headline violates banned opening words and regenerate if needed
    if (headlineViolatesBannedWords(validated.headline, bannedOpeningWords)) {
      validated = await regenerateHeadline({
        article: validated,
        bannedOpeningWords,
        recentTitles: input.recentArticleTitles,
      })
    }

    return {
      article: validated,
      usedRssTopic: actuallyUsedRssTopic, // Track server-side which RSS topic was actually used in the prompt
      usedDrugsTechno: useDrugsOrTechnoTopic || useDrugsOrTechnoScenario,
    }
  } catch {
    // Fallback: deterministic repair using cheaper model
    const repaired = await repairToSchema({
      badOutput: text,
      categories: input.categories,
      authors: input.authors,
    })
    return {
      article: repaired,
      usedRssTopic: actuallyUsedRssTopic, // Track server-side which RSS topic was actually used in the prompt
      usedDrugsTechno: useDrugsOrTechnoTopic || useDrugsOrTechnoScenario,
    }
  }
}
