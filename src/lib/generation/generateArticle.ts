import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import { trimToReadableLength } from '@/lib/text/trimToReadableLength'
import { normalizeExcerptForStorage } from '@/lib/text/excerptQuality'

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

export interface CanonicalStoryReference {
  author: string
  story: string
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
  recentCanonicalStoryReferences?: CanonicalStoryReference[] // Latest canonical references to avoid repeating author/story pairs
  // Variety control for cron job batches
  forceDrugsTechno?: boolean // Force drugs/techno topic (true) or force non-drugs/techno (false), undefined = random
  forceStartup?: boolean // Force startup/gentrification topic (true) or force non-startup (false), undefined = random
  forceRss?: boolean // Force using RSS topic if available
  forceOpinion?: boolean // Force opinion/editorial piece (categorySlug "opinion", layout "opinion")
  /** When set, pre-analysis is skipped and this summary is used for the blacklist. Cron runs analysis once per batch. */
  precomputedBlacklistSummary?: string
  /** Optional draft lock: when set, headline/subheadline/excerpt are forced to these values. */
  seedDraft?: {
    headline: string
    subheadline?: string | null
    excerpt?: string | null
    /** Optional topic/news hook selected during draft stage to preserve continuity. */
    topicHint?: string | null
  }
  /** Optional editorial revision instructions for this generation pass. */
  editorDirection?: string
  /** Optional manual controls for AI compose mode. */
  manualOverrides?: {
    /** If false, disable random style/theme pivots and use deterministic selections. */
    useRandomModes?: boolean
    /** If false, remove Wedding/Berlin-localized framing from prompts. */
    includeBerlinThemes?: boolean
    /** If true, require explicit topic entities in headline/opening instructions. */
    strictTopicFocus?: boolean
  }
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
  imagePrompt: z
    .string()
    .optional()
    .nullable()
    .transform((s) => (s != null && s.length > 600 ? s.slice(0, 600) : s)),
  // RSS source tracking - if article was inspired by an RSS news topic
  sourceRssTopic: z.string().max(300).optional().nullable(),
  // Canonical story source tracking - used when canonical adaptation mode is active
  canonicalSourceAuthor: z.string().max(120).optional().nullable(),
  canonicalSourceStory: z.string().max(220).optional().nullable(),
})

export type GeneratedArticle = z.infer<typeof GeneratedArticleSchema>

type OutputSchemaMode = 'full' | 'body-only-locked-draft'
const SOURCE_RSS_TOPIC_MAX = 300

export interface GenerateArticleResult {
  article: GeneratedArticle
  /** The RSS topic that was provided to the LLM (if any). Track this server-side for reliability. */
  usedRssTopic: string | null
  /** Whether this article used a drugs/techno topic/scenario. Used for variety tracking. */
  usedDrugsTechno: boolean
  /** Whether this article used a startup/gentrification topic/scenario. Used for variety tracking. */
  usedStartup: boolean
}

type ToneProfile = 'balanced' | 'acidic' | 'merciless'

const SatireBriefSchema = z.object({
  discomfortThesis: z.string().min(20).max(260),
  institutionTarget: z.string().min(4).max(140),
  hypocrisyMechanism: z.string().min(12).max(260),
  rightWingJab: z.string().min(12).max(260),
  leftWingJab: z.string().min(12).max(260),
  requiredConcreteDetails: z.array(z.string().min(3).max(120)).min(2).max(6),
  forbiddenCheapShots: z.array(z.string().min(3).max(120)).min(2).max(5),
})

type SatireBrief = z.infer<typeof SatireBriefSchema>

const SatireCritiqueSchema = z.object({
  darknessScore: z.number().int().min(1).max(10),
  politicalCriticismScore: z.number().int().min(1).max(10),
  discomfortScore: z.number().int().min(1).max(10),
  specificityScore: z.number().int().min(1).max(10),
  passes: z.boolean(),
  strongestLine: z.string().max(220),
  weaknesses: z.array(z.string().min(6).max(180)).min(1).max(5),
  revisionInstructions: z.array(z.string().min(6).max(200)).min(1).max(6),
})

type SatireCritique = z.infer<typeof SatireCritiqueSchema>

/******************* LOGGING ***********************/

const LOG = {
  prefix: '[ARTICLE]',
  sep: '────────────────────────────────────────────────────────────────',
  step: (label: string) =>
    console.log(`${LOG.prefix} ${LOG.sep}\n${LOG.prefix} ${label}\n${LOG.prefix} ${LOG.sep}`),
  /** Log a string trimmed to maxLen chars with "..." if truncated. */
  trimmed: (label: string, value: string, maxLen = 600) => {
    const trimmed = value.length <= maxLen ? value : value.slice(0, maxLen) + '...'
    console.log(`${LOG.prefix} ${label} (${value.length} chars):\n${trimmed}`)
  },
}

const REPETITION_GUARD_PREFIX = 'REPETITION_GUARD'

/**
 * Error thrown when an article is about wedding ceremonies instead of the Wedding neighborhood.
 * This triggers a full regeneration with explicit instructions.
 */
class WeddingCeremonyContentError extends Error {
  constructor(
    public readonly matchCount: number,
    public readonly matches: string[],
  ) {
    super(
      `Article contains wedding ceremony content (${matchCount} matches: ${matches.slice(0, 5).join(', ')}). The Wedding Times is about the Wedding NEIGHBORHOOD in Berlin, not wedding ceremonies.`,
    )
    this.name = 'WeddingCeremonyContentError'
  }
}

/**
 * Checks if an error is a WeddingCeremonyContentError (should trigger regeneration).
 */
function isWeddingCeremonyError(err: unknown): err is WeddingCeremonyContentError {
  return err instanceof WeddingCeremonyContentError
}

export function isRetryableGenerationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  // Retry on repetition guard errors
  if (error.message.includes(REPETITION_GUARD_PREFIX)) return true
  // Retry on wedding ceremony content errors (article was about weddings instead of Wedding neighborhood)
  if (isWeddingCeremonyError(error)) return true
  return false
}

/**
 * Run the cheap-model pre-analysis once per batch. Input: one title and one excerpt per recent article
 * (no other summaries). Do not set temperature — some models (e.g. gpt-5-nano) only support default.
 * Returns structured blacklist text or '' on failure.
 */
export async function summarizeRecentArticlesForBlacklist(params: {
  titles: string[]
  excerpts?: string[]
  apiKey?: string
}): Promise<string> {
  const { titles, excerpts = [], apiKey: providedKey } = params
  const apiKey = providedKey ?? process.env.OPENAI_API_KEY
  if (!apiKey || titles.length === 0) return ''

  const analysisModelName = process.env.OPENAI_ANALYSIS_MODEL ?? 'gpt-5-nano-2025-08-07'
  const analysisLlm = new ChatOpenAI({
    apiKey,
    model: analysisModelName,
    // Do not set temperature: nano and some models only support default (1).
  })

  const titlesWithExcerpts = titles
    .map((title, idx) => {
      const excerpt = excerpts[idx]
      return excerpt ? `- "${title}" — ${excerpt.slice(0, 150)}` : `- "${title}"`
    })
    .join('\n')

  try {
    const analysisResponse = await analysisLlm.invoke([
      {
        role: 'system',
        content: [
          'You are an editorial assistant. Analyze the following list of recently published satirical newspaper articles.',
          'Your job: produce a STRUCTURED SUMMARY of what has already been covered so a writer knows what to AVOID.',
          'Output ONLY the summary, no commentary. Be exhaustive — miss nothing. List every place, topic, substance, and joke premise.',
          'Phrase each item as something to AVOID (e.g. "Bikes vanishing / scooters replacing them"), not as an interesting idea. The writer must not be inspired by this list.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          'Analyze these recently published articles and produce a structured blacklist:\n',
          titlesWithExcerpts,
          '',
          'Produce the following sections (include every item you can extract):',
          '',
          'PLACES ALREADY USED (list every specific venue, street, park, neighborhood, or institution mentioned):',
          '- ...',
          '',
          'TOPICS ALREADY COVERED (list every distinct subject/theme/angle):',
          '- ...',
          '',
          'SUBSTANCES/DRUGS MENTIONED (list any drugs, substances, or drug-related references):',
          '- ...',
          '',
          'SPECIFIC JOKES/PREMISES ALREADY DONE (list the core comedic premise of each article in one sentence):',
          '- ...',
          '',
          'OVERREPRESENTED THEMES (topics that appear in 2+ articles — these are ESPECIALLY off-limits):',
          '- ...',
        ].join('\n'),
      },
    ])

    const summary =
      typeof analysisResponse.content === 'string'
        ? analysisResponse.content
        : JSON.stringify(analysisResponse.content)
    return summary
  } catch {
    return ''
  }
}

/******************* PROMPT CONSTANTS ***********************/

// Reusable prompt text blocks to avoid repetition

const INTELLECTUAL_SOURCES = `Literature: Kafka, Hemingway, Cormac McCarthy, Proust, Marguerite Duras, Philip K. Dick, Stendhal, Oscar Wilde, Voltaire, Dostoevsky, Tolstoy, James Joyce, Virginia Woolf, William Faulkner, Jorge Luis Borges, Gabriel Garcia Marquez, Thomas Mann, Herman Melville, Charles Dickens, Mark Twain, Edgar Allan Poe, Emily Dickinson, Walt Whitman, Baudelaire, Flaubert, Zola, Balzac, Victor Hugo, Goethe, Schiller, Chekhov, Gogol, Nabokov, Beckett, Ionesco, Brecht, Thomas Pynchon, Don DeLillo, Toni Morrison, Sylvia Plath, Albert Camus, Jean-Paul Sartre, Simone de Beauvoir, Roberto Bolano, Italo Calvino, Umberto Eco, Milan Kundera, Haruki Murakami, Salman Rushdie, Kurt Vonnegut, Hunter S. Thompson, Charles Bukowski, Jack Kerouac, William S. Burroughs, David Foster Wallace, Zadie Smith, Chimamanda Ngozi Adichie, Orwell, Aldous Huxley, Ray Bradbury, Isaac Asimov, Stanislaw Lem, J.G. Ballard, Ursula K. Le Guin, Margaret Atwood. Philosophy: Freud, Lacan, Marx, Hegel, Kant, Plato, Aristotle, Wittgenstein, Heidegger, Husserl, Merleau-Ponty, Kierkegaard, Nietzsche, Bertrand Russell, Quine, Austin, Searle, Rorty, Derrida, Baudrillard, Debord, Benjamin, Adorno, Confucius, I-Ching, Schopenhauer, Spinoza, Leibniz, John Stuart Mill, Hobbes, Locke, Rousseau, Voltaire, Montesquieu, Tocqueville, Hannah Arendt, Simone Weil, Michel Foucault, Gilles Deleuze, Slavoj Zizek, Judith Butler, Noam Chomsky, Peter Singer, Martha Nussbaum, Byung-Chul Han, Zygmunt Bauman, Theodor Adorno, Herbert Marcuse, Antonio Gramsci, Louis Althusser, Georg Lukacs, Karl Popper, Thomas Kuhn, Umberto Eco, Roland Barthes, Susan Sontag. Cinema: Truffaut, Coppola, Godard, Kubrick, Hitchcock, Fellini, Bergman, Tarkovsky, Kurosawa, David Lynch, Quentin Tarantino, Martin Scorsese, Werner Herzog, Wim Wenders, Fassbinder, Lars von Trier, Pedro Almodovar, Andrei Tarkovsky, Jean-Luc Godard, Orson Welles, Billy Wilder, Fritz Lang, Ridley Scott, the Coen Brothers, Spike Lee, Park Chan-wook, Bong Joon-ho, Denis Villeneuve, Charlie Kaufman, Wes Anderson, Sofia Coppola, Michael Haneke. Art & Music: John Cage, Duchamp, Picasso, Bach, Beethoven, Chopin, Andy Warhol, Basquiat, Banksy, Frida Kahlo, Salvador Dali, Magritte, Mondrian, Rothko, Pollock, Kandinsky, Klimt, Egon Schiele, Francis Bacon, Damien Hirst, Jeff Koons, Ai Weiwei, Marina Abramovic, Yoko Ono, Mozart, Wagner, Debussy, Stravinsky, Miles Davis, John Coltrane, Kraftwerk, Brian Eno, David Bowie, Radiohead, Bjork, Aphex Twin, Stockhausen.`

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
  '',
  'COMEDIC VOICE - AUTHENTIC SOCIAL CRITICISM (THIS IS CRITICAL):',
  '- Channel Oscar Wilde, Louis CK, Ricky Gervais, George Carlin, Bill Hicks, Doug Stanhope, Bill Burr, Frankie Boyle.',
  '- The humor must come from REAL uncomfortable truths about society, not just wacky absurdism.',
  '- Say the thing everyone is THINKING but nobody dares to say out loud. Name the hypocrisy directly.',
  '- Observe real human behavior and call out the bullshit: the performative activism, the moral posturing, the self-deception, the cowardice disguised as politeness.',
  '- Examples of the RIGHT tone:',
  '  * A gentrifier writing a think-piece about "preserving neighborhood character" from their 2000-euro loft',
  '  * Expats who complain about other expats ruining the city while being expats themselves',
  '  * People posting black squares on Instagram while their cleaning lady is undocumented',
  '  * The guy who microdoses and calls it "wellness" but judges the Görlitzer Park dealer for selling weed',
  '  * Berlin leftists who hate capitalism but need daddy to wire rent money every month',
  '- The comedy is in the TRUTH, not in randomness. Every joke should make someone think "shit, that IS what people do".',
  '- Be specific about WHO you are mocking and WHY. Vague satire is weak satire.',
  '- Punch at real contradictions: people who claim to be open-minded but are the most judgmental, people who fetishize poverty while being rich, people who moved here "for the culture" but only hang out with other expats.',
  '- The best joke is the one where the reader recognizes themselves and feels personally attacked.',
].join('\n')

const EDGE_SHORT = [
  'EDGE AND POLITICAL INCORRECTNESS:',
  '- Push beyond "nice absurdity". Make readers uncomfortable. Challenge assumptions.',
  '- The goal is "I don\'t know if I should laugh" not "haha that\'s cute"',
  '- Tackle taboo subjects with dark humor. Make fun of everyone equally.',
  '- Use uncomfortable truths wrapped in absurdity. Make readers squirm.',
  '- Channel Oscar Wilde / Louis CK / Ricky Gervais / George Carlin: say the thing everyone THINKS but nobody dares say.',
  '- The comedy must come from REAL observations about human hypocrisy, not just random absurdism.',
  '- Name specific contradictions: the gentrifier who mourns gentrification, the leftist funded by daddy, the wellness guru who does coke.',
  '- The best satire makes the reader recognize themselves and feel personally attacked.',
].join('\n')

export const HUMOR_PERSPECTIVE_METHOD = [
  'PRIMARY DIRECTIVE — HUMOR ENGINE (TOP PRIORITY, MANDATORY):',
  '- This is the main rule for this generation. Treat all other style guidance as secondary.',
  '- If any instruction conflicts with this humor engine, follow this humor engine.',
  '- Humor must come from a perspective shift, not random absurdity.',
  '- Start with the expected narrative around the topic (what people claim this is about).',
  '- Zoom into under-noticed concrete details: logistics, wording, incentives, side effects, rituals, status signals, tiny behaviors.',
  '- Find one detail that implies the opposite of the official narrative.',
  '- Build the core joke around that contradiction (stated intention vs observed behavior).',
  '- Avoid obvious takes and generic mockery; choose the less-obvious detail most people ignore.',
  '- Do NOT use the exact phrase "overlooked detail" in the output text; express the idea naturally in different words.',
  '- Prefer specific observable facts and consequences over abstract opinion.',
  '- PASS/FAIL: if the piece does not center this contradiction, it fails.',
].join('\n')

const TONE_PROFILE_GUIDANCE: Record<ToneProfile, string> = {
  balanced:
    'Write biting satire with controlled aggression. Criticize institutions and hypocrisy hard, but keep punchlines measured.',
  acidic:
    'Write darker satire with sharp political criticism. Be ruthless about hypocrisy and force uncomfortable self-recognition.',
  merciless:
    'Write maximum-intensity dark satire. Be clinically cynical, politically aggressive, and socially uncomfortable while avoiding slurs, hate speech, and calls for harm.',
}

const AVOID_OVERUSED_THEMES = [
  'AVOID OVERUSING THESE THEMES (they matter, but we run them into the ground):',
  '- "Authenticity" / "real Berlin" / "keeping it real" / "the old Berlin" — do NOT make this the central joke again unless the blacklist shows it has not been used recently.',
  '- Rent / rent prices / "daddy pays the rent" / "cheap rent" / rent protests — do NOT make rent the main punchline again unless the blacklist shows it has not been used recently.',
  '- Wellness/calm/silence/quiet as a commodity or "serenity-as-a-service" that gets monetized or converted into rent — this premise has been overused; do NOT write another "wellness startup converts calm/silence into rent" story.',
  '- Prefer other angles: bureaucracy, nightlife specifics, food, neighborhood politics, expat hypocrisy, tech/startups, local characters, crime, absurd local events. Use authenticity and rent sparingly.',
].join('\n')

const SPICE_IT_UP = [
  'SPICE IT UP (subtle sexual innuendo):',
  '- Include 2-3 subtle double entendres or sexual innuendo that can be read innocently or suggestively',
  '- Use phrases that have a second, sexual meaning when read carefully. VARY YOUR CHOICES widely from examples like:',
  '  * "penetrating the bureaucracy", "deep dive into the matter", "hard to swallow", "stiff resistance"',
  '  * "coming from behind in the polls", "a firm grip on the situation", "going down in the rankings"',
  '  * "mounting pressure", "climaxing at the wrong moment", "throbbing nightlife scene"',
  '  * "slippery when wet (the Leopoldplatz fountain)", "getting into tight spaces", "a long and arduous entry process"',
  '  * "blowing the budget", "stroking egos", "rubbing residents the wrong way"',
  '  * "erected overnight", "the long-awaited opening", "pulling out of the deal at the last second"',
  '  * "getting on top of the housing crisis", "riding the wave of gentrification", "finishing too quickly"',
  '  * "exposed positions", "a backdoor arrangement", "stimulating the local economy"',
  '  * "laying pipe (construction)", "going all the way to the Bürgeramt", "a satisfying resolution"',
  '  * "grinding to a halt", "the tip of the iceberg", "sliding into new territory"',
  '- DO NOT reuse the same innuendo across articles. Each article should have FRESH double entendres.',
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

export const WEDDING_REMINDER_SHORT = [
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
  '- Stamps (NOT wristbands — Berlin techno clubs use ink stamps, not wristbands) as status symbols, protected like investments',
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

// Strong version - used when startup/gentrification topic IS selected
const BERLIN_STARTUP_CULTURE_STRONG = [
  'CRITICAL BERLIN CULTURE ELEMENTS - STARTUP AND GENTRIFICATION:',
  "Berlin's transformation from a cheap, gritty, creative city into a sanitized startup playground is one of its defining tragedies. This is not optional flavor—it's the city's open wound.",
  'Your topic is about startup culture/gentrification, so LEAN INTO IT FULLY:',
  '- Co-working spaces: WeWork, Factory Berlin, Betahaus, St. Oberholz, the endless "creative hubs" with exposed brick',
  '- IMPORTANT: Do NOT only mention WeWork! Vary your co-working/startup references.',
  '- Tech bros explaining blockchain/AI/Web3 to baristas who could not care less',
  '- Startup founders who think their app will save the world (it delivers smoothies)',
  '- Pitch nights, demo days, "disruption" as a buzzword for selling the same thing with an app',
  '- Venture capital money flooding in, turning dive bars into cocktail lounges',
  '- The performative minimalism: owning nothing but a MacBook and calling it enlightenment',
  '- English becoming the default language—menus, meetings, entire neighborhoods',
  '- Yoga studios, mindfulness retreats, vegan brunch spots charging 18 euros for avocado toast',
  '- The wellness-to-crypto pipeline: spiritual people who discovered NFTs',
  '- Expats who moved here "for the culture" but only hang out with other expats in English-speaking bubbles',
  '- Turkish bakeries becoming matcha cafés, Spätis becoming organic juice bars',
  '- Rents doubling in 5 years, longtime residents pushed to the outskirts',
  '- The hypocrisy: gentrifiers who attend anti-gentrification protests, then go home to their renovated Altbau',
  '- Prenzlauer Berg parents with 3000-euro strollers lecturing about simplicity',
  '- The "I moved here in 2019 and it was already ruined" crowd',
  '- Startup culture as colonialism: extracting value from a city and giving back nothing but high rents',
  '',
  'Make startup culture and gentrification feel as present and invasive as it actually is—because in Berlin, it is eating the city alive.',
].join('\n')

// Mild version - used when startup/gentrification topic is NOT selected
const BERLIN_STARTUP_CULTURE_MILD = [
  'BERLIN CULTURE NOTE:',
  'Your topic is NOT about startup culture/gentrification, so focus on your assigned subject.',
  'Berlin has many facets beyond the tech scene: nightlife, bureaucracy, Turkish community,',
  'neighborhood life, BVG chaos, Späti culture, crime, food, art, drugs/techno.',
  'Write about what your topic calls for—do not shoehorn startups or gentrification into unrelated stories.',
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

const CANONICAL_WEDDING_STORY_STRUCTURE = [
  'CANONICAL ADAPTATION STRUCTURE (ACTIVE FOR THIS ARTICLE):',
  '- This article MUST be built as a Wedding/Berlin adaptation of ONE canonical Western story.',
  '- Pick exactly one source tradition: Bible, Greek mythology, Shakespeare, Cervantes, or another widely recognized Western canon story.',
  '- Adapt the core conflict/archetypes/themes into Wedding/Berlin reality while keeping all your other assigned instructions (topic, tone, satire, local details).',
  '- Do NOT retell the source beat-by-beat. Loose adaptation is preferred; take the essence and transform it.',
  '- Keep the piece grounded as satire/news-style writing for The Wedding Times, not as fantasy lore exposition.',
  '- REQUIRED NARRATIVE SHAPE: write as a journalistic chronicle with a clear protagonist and a chronological sequence of events.',
  '- MAIN CHARACTER REQUIREMENT: choose one clearly identifiable main character (full name, role, and relation to Wedding/Berlin) and keep them central from beginning to end.',
  '- SUPPORTING CAST: include 1-3 supporting characters (witnesses, officials, neighbors, rivals, etc.) who interact with the main character and move the story forward.',
  '- STAKES: make explicit what the main character wants, what blocks them, and what they risk losing (status, money, reputation, housing, access, relationships, etc.).',
  '- ARC: show a progression for the main character (initial situation -> pressure/conflict -> decision/action -> outcome or cliffhanger).',
  '- TURNING POINTS: include at least one clear turning point where new information, a public reaction, or an institutional decision changes the direction of events.',
  '- The body MUST include: (1) setup scene, (2) triggering incident, (3) escalation with concrete actions/reactions, (4) consequence or unresolved ending.',
  '- Use concrete chronology markers (for example: "on Monday morning", "later that afternoon", "by evening", "the next day").',
  '- Include named characters and at least one quote tied to the event sequence.',
  '- Avoid abstract essay mode. This is a reported story about what happened, in order.',
  '- This assignment is NOT for opinion pieces. Do NOT output categorySlug "opinion" or layout "opinion" when this mode is active.',
  '- Do NOT explicitly name or cite the source author/tradition/story in the article text.',
  '- Keep the adaptation implicit for readers; only the editorial metadata should carry the canonical reference.',
  '- You MUST fill canonicalSourceAuthor and canonicalSourceStory in JSON when this mode is active.',
  '- OPTIONAL TAGLINE (RARE): only when the narrative genuinely ends unresolved, you MAY end with the exact phrase "Story in development."',
  '- Do NOT use that tagline by default. It should appear in a small minority of canonical stories, never in most outputs.',
  '- If you use the tagline, spell it exactly as: "Story in development." (capital S, period).',
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
  '  "sourceRssTopic": string|null,  // If inspired by RSS, copy the news headline verbatim (headline only; no source labels). Otherwise null.',
  '  "canonicalSourceAuthor": string|null,  // If canonical adaptation mode is active, author/tradition of the source (e.g. "Homer", "Shakespeare", "The Bible"). Otherwise null.',
  '  "canonicalSourceStory": string|null  // If canonical adaptation mode is active, specific source work/story (e.g. "Odyssey", "Hamlet", "Book of Job", "Don Quixote"). Otherwise null.',
  '}',
].join('\n')

const JSON_SCHEMA_BODY_ONLY = [
  'JSON schema (LOCKED DRAFT MODE):',
  '{',
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
  '  "imagePrompt": string|null,  // <= 600 chars',
  '  "canonicalSourceAuthor": string|null,  // If canonical adaptation mode is active, author/tradition of the source. Otherwise null.',
  '  "canonicalSourceStory": string|null  // If canonical adaptation mode is active, specific source work/story. Otherwise null.',
  '}',
].join('\n')

const AUTHOR_SELECTION = [
  'AUTHOR SELECTION:',
  'You have two options for the author:',
  '1. Pick an existing author from the list below (use their slug as authorSlug)',
  '2. Create a new author ONLY when none of the existing authors fit the story voice.',
  'Default behavior: reuse an existing author. New authors should be rare.',
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

const SURREALISM_AND_LOCAL_KNOWLEDGE = [
  'SURREALISM STYLE (CRITICAL - THIS DEFINES THE PAPER):',
  'The best articles have a TINY surrealist or absurdist twist grounded in REAL local knowledge. Think Yorgos Lanthimos, David Lynch, Monty Python, Boris Vian, Groucho Marx:',
  '- DO NOT announce the surrealism. Never write meta lines like "then it got surreal", "now the surreal part", "it then became absurd", or similar framing.',
  '- The article itself must simply be written as if events are being reported normally. Let readers FEEL the absurdity from the events, not from commentary about tone.',
  '- The premise is just ONE small step beyond reality — not 10 steps. One impossible thing happens; everything else reacts realistically.',
  '- The surreal element MUST be rooted in a REAL, SPECIFIC detail about the place. You need to KNOW the location to make the joke work.',
  '',
  'WHAT GOOD SURREALISM LOOKS LIKE (understand the pattern, then invent your OWN):',
  '- A real venue has a real physical feature. One tiny impossible thing happens to that feature. People react in a completely believable way.',
  '- The comedy comes from: (1) real knowledge of the venue, (2) a small impossible thing, (3) a completely believable human reaction.',
  '',
  'EXAMPLES of the right LEVEL of surrealism (understand the pattern — DO NOT use any of these):',
  "- A Bürgeramt appointment number counter starts going backwards — and nobody notices because they've been waiting so long they stopped reading it.",
  '- The Leopoldplatz fountain develops a very slight current that slowly pulls nearby benches toward it, a few centimeters per day.',
  '- A Späti owner discovers his shop has been open for 72 hours straight because neither he nor his brother remembered whose shift it was.',
  '',
  'BAD surrealism (TOO MUCH — avoid):',
  '- "Berghain develops sentience" (too fantastical)',
  '- "Berlin becomes a floating city" (too big, not grounded)',
  '- "Time stops inside techno clubs" (too abstract, too metaphorical)',
  '',
  'THE RULE: If you need more than ONE sentence to explain the surreal premise, it is too complicated. Keep it simple, small, and grounded.',
  '',
  'LOCAL KNOWLEDGE IS MANDATORY:',
  '- Your surreal premise MUST exploit a REAL detail about the location, venue, or situation.',
  '- Kater Blau: on the Spree river, has floating platforms, garden area, known for long parties',
  '- Berghain: inside a former power plant, famous door policy, Panorama Bar upstairs, dark interiors, Darkroom on the top floor',
  '- Sisyphos: in an old dog biscuit factory, has a hammock area, outdoor stages, parties that last days',
  '- About Blank: has a garden with bonfires, politically active, known for leftist events',
  '- Görlitzer Park: known for open drug dealing, specific tree-lined paths, playground that coexists with dealers',
  '- Bürgeramt/Bürgerämter: number ticket system, plastic chairs, Kafkaesque waiting rooms, forms in triplicate',
  '- Leopoldplatz: fountain, morning market, benches where regulars sit, Späti cluster on the corners',
  '- Tresor: underground vault (former bank), metal staircase, industrial basement',
  '- Kitkat: famous for its dress code (or undress code), pool area, themed nights',
  '- Wilde Renate: labyrinthine rooms across multiple floors, secret passages, bathtub installations',
  '- Golden Gate: tiny club under a bridge, sunrise sessions, cramped dance floor',
  '- IMPORTANT: Berlin techno clubs use INK STAMPS on your hand/arm — NOT wristbands. Wristbands are for festivals.',
  "- If you don't know a real specific detail about the place, pick a different location you DO know about.",
].join('\n')

const SOURCE_ATTRIBUTION_RULES = [
  'SOURCE ATTRIBUTION RULES (MANDATORY):',
  '- Never mention external publisher names in the article text.',
  '- Forbidden examples: "an article of the New York Times", "the Berliner-Zeitung", "NYTimes".',
  '- Do NOT write "according to another newspaper" or "as reported by <publisher>".',
  '- Use only the underlying topic and write as original local reporting/satire.',
].join('\n')

const NEWSPAPER_STRUCTURE_RULES = [
  'NEWSPAPER STRUCTURE (MANDATORY FOR NON-OPINION PIECES):',
  '- Write as a publishable newspaper article, not a sketch, list, or abstract rant.',
  '- OPENING LEAD must answer who/what/where quickly (first paragraph).',
  '- Include chronological movement (what happened first, then what followed).',
  '- Include at least one attributed quote from a named person/source.',
  '- Include at least one institutional or official reaction when relevant (BVG, district office, police, landlord association, club spokesperson, etc.).',
  '- End with a concrete consequence, unresolved development, or immediate next step.',
  '- If categorySlug="opinion" and layout="opinion", follow OPINION_PIECE_FORMAT instead of this rule.',
].join('\n')

const NEWSPAPER_VARIANT_GUIDE = [
  'ARTICLE FORMAT VARIANTS (PICK THE ONE THAT FITS THE STORY):',
  '- News Report: hard-news lead, evidence/details, quotes, consequence.',
  '- Police Chronicle: incident timeline, witnesses, authority statement, status update.',
  '- Civic/Bureaucracy Dispatch: procedural friction, affected residents, office response, practical fallout.',
  '- Nightlife/Scene Chronicle: event timeline, participants, venue details, morning-after consequences.',
  '- Opinion Editorial (only when opinion mode): first-person argument and personal thesis.',
].join('\n')

const ANTI_META_SURREAL_RULES = [
  'ANTI-META SURREAL RULES (MANDATORY):',
  '- Never narrate tone using phrases like "the surreal part", "then it got surreal", "in a surreal/absurd twist".',
  '- Never explain that the story is absurd. Report events plainly; let absurdity emerge from facts and reactions.',
  '- Replace meta framing with concrete observable detail (actions, quotes, consequences).',
].join('\n')

const AFR_RECURRING_STORY_RULES = [
  'AFR RECURRING STORY MODE (MANDATORY WHEN ACTIVE):',
  '- "Alternativ für Ratten (AfR)" is a fictional far-right rat party in Berlin.',
  '- Party leader: Alice Rattenweidel.',
  '- Cover AfR developments as satirical political reporting.',
  '- Include recognizable far-right tropes: anti-immigrant posturing, racist dog whistles, pro-Russia talking points, anti-EU panic, culture-war theatrics.',
  '- The tone must MOCK and CRITICIZE these positions; never endorse them.',
  '- No slurs, explicit hate speech, or calls for harm.',
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

/** Minimal stopwords for overlap check (subset of extractOverusedKeywords stopwords). */
const OVERLAP_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'are',
  'was',
  'were',
  'have',
  'has',
  'had',
  'been',
  'being',
  'will',
  'would',
  'could',
  'not',
  'you',
  'your',
  'they',
  'their',
  'what',
  'when',
  'where',
  'which',
  'who',
  'how',
  'all',
  'any',
  'can',
  'her',
  'his',
  'its',
  'our',
  'out',
  'say',
  'see',
  'she',
  'than',
  'them',
  'then',
  'these',
  'those',
  'own',
])

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.trunc(parsed)
}

function parseEnvFloat(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

const REPETITION_BIGRAM_MIN = Math.max(1, parseEnvInt('REPETITION_GUARD_BIGRAM_MIN', 3))
const REPETITION_WORDS_WITH_JACCARD_MIN = Math.max(
  1,
  parseEnvInt('REPETITION_GUARD_WORDS_WITH_JACCARD_MIN', 4),
)
const REPETITION_JACCARD_MIN = Math.max(0, parseEnvFloat('REPETITION_GUARD_JACCARD_MIN', 0.34))
const REPETITION_WORDS_WITH_BIGRAM_MIN = Math.max(
  1,
  parseEnvInt('REPETITION_GUARD_WORDS_WITH_BIGRAM_MIN', 3),
)
const REPETITION_CO_BIGRAM_MIN = Math.max(1, parseEnvInt('REPETITION_GUARD_CO_BIGRAM_MIN', 2))
const REPETITION_WORD_ONLY_MIN = Math.max(1, parseEnvInt('REPETITION_GUARD_WORD_ONLY_MIN', 11))
const REPETITION_WORD_ONLY_JACCARD_MIN = Math.max(
  0,
  parseEnvFloat('REPETITION_GUARD_WORD_ONLY_JACCARD_MIN', 0.11),
)

/**
 * Extract significant (non-stopword, length >= 3) tokens from text, lowercase.
 * Keeps token order for n-gram similarity checks.
 */
function getSignificantTokenSequence(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)

  const out: string[] = []
  for (const w of words) {
    const cleaned = w.replace(/[^a-z]/g, '')
    if (cleaned.length >= 3 && !OVERLAP_STOPWORDS.has(cleaned)) out.push(cleaned)
  }
  return out
}

/**
 * Extract significant words as a set (deduplicated).
 * Used to detect overlap between an RSS topic and blacklisted content.
 */
function getSignificantWords(text: string): Set<string> {
  return new Set(getSignificantTokenSequence(text))
}

function buildTokenBigrams(tokens: string[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`)
  }
  return out
}

function countSetOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  let count = 0
  for (const item of small) {
    if (large.has(item)) count += 1
  }
  return count
}

type SimilarityAssessment = {
  overlaps: boolean
  score: number
  reason: string
}

function assessPairSimilarity(candidate: string, reference: string): SimilarityAssessment {
  const candidateTokens = getSignificantTokenSequence(candidate)
  const referenceTokens = getSignificantTokenSequence(reference)
  if (candidateTokens.length === 0 || referenceTokens.length === 0) {
    return { overlaps: false, score: 0, reason: 'insufficient tokens' }
  }

  const candidateWords = new Set(candidateTokens)
  const referenceWords = new Set(referenceTokens)
  const overlapWords = countSetOverlap(candidateWords, referenceWords)
  const unionSize = candidateWords.size + referenceWords.size - overlapWords
  const jaccard = unionSize > 0 ? overlapWords / unionSize : 0

  const candidateBigrams = buildTokenBigrams(candidateTokens)
  const referenceBigrams = buildTokenBigrams(referenceTokens)
  const overlapBigrams = countSetOverlap(candidateBigrams, referenceBigrams)

  const overlaps =
    overlapBigrams >= REPETITION_BIGRAM_MIN ||
    (overlapWords >= REPETITION_WORDS_WITH_JACCARD_MIN && jaccard >= REPETITION_JACCARD_MIN) ||
    (overlapWords >= REPETITION_WORDS_WITH_BIGRAM_MIN &&
      overlapBigrams >= REPETITION_CO_BIGRAM_MIN) ||
    (overlapWords >= REPETITION_WORD_ONLY_MIN && jaccard >= REPETITION_WORD_ONLY_JACCARD_MIN)

  return {
    overlaps,
    score: overlapWords * 2 + overlapBigrams * 3 + jaccard * 10,
    reason: `wordOverlap=${overlapWords}, bigramOverlap=${overlapBigrams}, jaccard=${jaccard.toFixed(2)}`,
  }
}

export function assessRecentCoverageOverlap(params: { candidate: string; references: string[] }): {
  overlaps: boolean
  score: number
  reason: string
  matchedReference: string | null
} {
  const { candidate, references } = params
  if (!candidate.trim() || references.length === 0) {
    return { overlaps: false, score: 0, reason: 'no references', matchedReference: null }
  }

  let bestScore = 0
  let bestReason = 'no overlap'
  let bestReference: string | null = null
  let overlapScore = -1
  let overlapReason = ''
  let overlapReference: string | null = null

  for (const reference of references) {
    const assessment = assessPairSimilarity(candidate, reference)
    if (assessment.score > bestScore) {
      bestScore = assessment.score
      bestReason = assessment.reason
      bestReference = reference
    }
    if (assessment.overlaps && assessment.score > overlapScore) {
      overlapScore = assessment.score
      overlapReason = assessment.reason
      overlapReference = reference
    }
  }

  if (overlapScore >= 0) {
    return {
      overlaps: true,
      score: overlapScore,
      reason: overlapReason,
      matchedReference: overlapReference,
    }
  }

  return {
    overlaps: false,
    score: bestScore,
    reason: bestReason,
    matchedReference: bestReference,
  }
}

function buildRecentCoverageReferences(params: {
  titles: string[]
  excerpts?: string[]
  blacklistSummary?: string
  latestArticleContentSample?: string
  maxItems?: number
}): string[] {
  const {
    titles,
    excerpts = [],
    blacklistSummary,
    latestArticleContentSample,
    maxItems = 30,
  } = params
  const references = new Set<string>()

  const titleLimit = Math.min(maxItems, titles.length)
  for (let i = 0; i < titleLimit; i++) {
    const title = titles[i]?.trim() ?? ''
    if (!title) continue
    const excerpt = excerpts[i]?.trim() ?? ''
    references.add(excerpt ? `${title} ${excerpt}` : title)
  }

  if (blacklistSummary && blacklistSummary.trim().length > 0) {
    references.add(blacklistSummary.trim())
  }

  if (latestArticleContentSample && latestArticleContentSample.trim().length > 0) {
    references.add(latestArticleContentSample.trim())
  }

  return Array.from(references)
}

function pickCandidateAvoidingRecentCoverage(params: {
  candidates: string[]
  references: string[]
  fallback: string
  label: string
  useRandom?: boolean
}): string {
  const { candidates, references, fallback, label, useRandom = true } = params
  if (candidates.length === 0) return fallback
  if (references.length === 0) {
    return useRandom
      ? (candidates[Math.floor(Math.random() * candidates.length)] ?? fallback)
      : (candidates[0] ?? fallback)
  }

  const scored = candidates.map((candidate) => ({
    candidate,
    ...assessRecentCoverageOverlap({ candidate, references }),
  }))
  const nonOverlapping = scored.filter((entry) => !entry.overlaps)
  if (nonOverlapping.length > 0) {
    const selected = useRandom
      ? nonOverlapping[Math.floor(Math.random() * nonOverlapping.length)]
      : nonOverlapping[0]
    return selected?.candidate ?? fallback
  }

  const bestScore = Math.min(...scored.map((entry) => entry.score))
  const leastOverlapping = scored.filter((entry) => entry.score === bestScore)
  const selected = useRandom
    ? leastOverlapping[Math.floor(Math.random() * leastOverlapping.length)]
    : leastOverlapping[0]
  console.warn(
    `${LOG.prefix} All ${label} candidates overlapped recent coverage; using least-overlapping fallback`,
  )
  return selected?.candidate ?? fallback
}

function pickFromList<T>(items: T[], useRandom: boolean): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty list')
  }
  if (!useRandom) return items[0] as T
  return items[Math.floor(Math.random() * items.length)] as T
}

function buildArticleRepetitionFingerprint(article: GeneratedArticle): string {
  return [
    article.headline,
    article.subheadline ?? '',
    article.excerpt ?? '',
    article.bodyMarkdown.slice(0, 420),
  ].join(' ')
}

function assertArticleNotTooSimilarToRecentCoverage(params: {
  article: GeneratedArticle
  recentTitles: string[]
  recentExcerpts: string[]
  latestArticleContentSample?: string
}): void {
  const references = buildRecentCoverageReferences({
    titles: params.recentTitles,
    excerpts: params.recentExcerpts,
    latestArticleContentSample: params.latestArticleContentSample,
    maxItems: 30,
  })
  if (references.length === 0) return

  const assessment = assessRecentCoverageOverlap({
    candidate: buildArticleRepetitionFingerprint(params.article),
    references,
  })
  if (!assessment.overlaps) return

  const matched = assessment.matchedReference
    ? assessment.matchedReference.replace(/\s+/g, ' ').slice(0, 140)
    : 'unknown'
  throw new Error(
    `${REPETITION_GUARD_PREFIX}: Generated article overlaps recent coverage (${assessment.reason}); matched="${matched}"`,
  )
}

function normalizeRssTopicLine(line: string): string {
  const parsed = parseTopicSummaryLine(line)
  return parsed?.value ?? line.trim().replace(/^-+\s*/, '')
}

type TopicSummarySource = 'rss' | 'manual' | 'hint' | 'unknown'

type TopicSummaryLine = {
  source: TopicSummarySource
  value: string
}

function parseTopicSummaryLine(line: string): TopicSummaryLine | null {
  const withoutBullet = line.trim().replace(/^-+\s*/, '')
  if (!withoutBullet) return null

  const sourceTagged = withoutBullet.match(/^\[([^\]]+)\]\s*(.+)$/)
  if (!sourceTagged?.[2]) {
    return { source: 'unknown', value: withoutBullet }
  }

  const sourceRaw = sourceTagged[1]?.trim().toLowerCase() ?? ''
  const value = sourceTagged[2].trim()
  if (!value) return null

  if (sourceRaw === 'rss' || sourceRaw === 'manual' || sourceRaw === 'hint') {
    return { source: sourceRaw, value }
  }
  return { source: 'unknown', value }
}

function parseTopicSummary(topicSummary: string): TopicSummaryLine[] {
  return topicSummary
    .trim()
    .split('\n')
    .map((line) => parseTopicSummaryLine(line))
    .filter((line): line is TopicSummaryLine => line != null)
}

const AFD_TOPIC_PATTERN = /\bafd\b|alternative\s+f(?:u|ü)r\s+deutschland/i
const AFR_TOPIC_PATTERN = /\bafr\b|alternativ\s+f(?:u|ü)r\s+ratten|alice\s+rattenweidel/i

function isAfDTopic(text: string): boolean {
  return AFD_TOPIC_PATTERN.test(text)
}

function isAfRTheme(text: string): boolean {
  return AFR_TOPIC_PATTERN.test(text)
}

/******************* WEDDING CEREMONY DETECTION ***********************/
// CRITICAL: "Wedding" is a neighborhood in Berlin, NOT a wedding ceremony.
// This detector catches articles that are mistakenly about marriage/wedding ceremonies.

// Patterns that indicate wedding CEREMONY content (not the neighborhood)
const WEDDING_CEREMONY_PATTERNS: RegExp[] = [
  // Lowercase "wedding" or "weddings" (the neighborhood is always capitalized as "Wedding")
  /\bwedding(?:s)?\b/g, // lowercase wedding/weddings
  // Marriage ceremony phrases (specific contexts only - avoid overly broad patterns like standalone "I do")
  /\bwalk(?:ing|ed)?\s+down\s+the\s+aisle\b/gi,
  /\bdown\s+the\s+aisle\b/gi,
  /\bbride(?:s|'s)?\b/gi,
  /\bgroom(?:s|'s)?\b/gi,
  /\bbridal\b/gi,
  /\bmarriage\s+ceremon(?:y|ies)\b/gi,
  /\bwedding\s+(?:dress|gown|cake|ring|vow|venue|planner|reception|ceremony|party|day|band|photographer|invitation|guest|registry|toast|bouquet|chapel|officiant)/gi,
  /\bmarry(?:ing)?\s+(?:me|you|him|her|them)\b/gi,
  /\btie\s+the\s+knot\b/gi,
  /\bsay(?:ing)?\s+["']?i do["']?\b/gi, // Only "saying I do" - not standalone "I do" which is too broad
  /\bexchange(?:d|ing)?\s+(?:vows|rings)\b/gi,
  /\bmatrimon(?:y|ial)\b/gi,
  /\bnewlywed(?:s)?\b/gi,
  /\bhoneymoon(?:s|ing|ed)?\b/gi,
  /\bengagement\s+(?:ring|party|photo)\b/gi,
  /\bbest\s+man\b/gi,
  /\bmaid\s+of\s+honor\b/gi,
  /\bflower\s+girl\b/gi,
  /\bring\s+bearer\b/gi,
  /\bwedded\s+bliss\b/gi,
  /\bmarital\b/gi,
  /\bspous(?:e|al)\b/gi,
  /\bbetrothed\b/gi,
]

// Whitelist patterns: these contain "wedding" but are about the NEIGHBORHOOD or legitimate Berlin topics
const WEDDING_NEIGHBORHOOD_WHITELIST: RegExp[] = [
  /\bWedding\s+(?:neighborhood|district|area|resident|local|street|café|bar|Späti|U-Bahn|S-Bahn|station|scene|gentrification)\b/i,
  /\bin\s+Wedding\b/i, // "in Wedding" (the neighborhood)
  /\bWedding,?\s+Berlin\b/i,
  /\bthe\s+Wedding\s+Times\b/i,
  /\bClan\s+wedding\b/i, // Clan weddings are a Berlin crime story topic
  /\bwedding\s+hall\b/i, // Turkish community centers as wedding halls - legitimate
]

/**
 * Detects if an article is mistakenly about wedding ceremonies instead of the Wedding neighborhood.
 * Returns the number of ceremony-related matches found.
 */
function detectWeddingCeremonyContent(article: GeneratedArticle): {
  hasCeremonyContent: boolean
  matchCount: number
  matches: string[]
} {
  const fullText = [
    article.headline,
    article.subheadline ?? '',
    article.excerpt ?? '',
    article.bodyMarkdown,
  ].join(' ')

  // First check whitelist - if the article clearly mentions the neighborhood, be more lenient
  const hasNeighborhoodContext = WEDDING_NEIGHBORHOOD_WHITELIST.some((pattern) =>
    pattern.test(fullText),
  )

  const matches: string[] = []

  for (const pattern of WEDDING_CEREMONY_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0
    const patternMatches = fullText.match(pattern)
    if (patternMatches) {
      matches.push(...patternMatches)
    }
  }

  // If we have clear neighborhood context, require more matches to trigger
  const threshold = hasNeighborhoodContext ? 5 : 2

  return {
    hasCeremonyContent: matches.length >= threshold,
    matchCount: matches.length,
    matches: [...new Set(matches)].slice(0, 10), // Dedupe and limit
  }
}

/**
 * Checks article for wedding ceremony content and throws if detected.
 * This forces a regeneration with the correct context.
 */
function assertNotAboutWeddingCeremonies(article: GeneratedArticle): void {
  const detection = detectWeddingCeremonyContent(article)
  if (detection.hasCeremonyContent) {
    console.warn(
      `${LOG.prefix} WEDDING CEREMONY CONTENT DETECTED: ${detection.matchCount} matches found: ${detection.matches.join(', ')}`,
    )
    throw new WeddingCeremonyContentError(detection.matchCount, detection.matches)
  }
}

function sanitizeForbiddenSourceMentions(text: string): string {
  return text
    .replace(/\ban?\s+article\s+of\s+the\s+new york times\b/gi, 'a recent report')
    .replace(/\ban?\s+article\s+from\s+the\s+new york times\b/gi, 'a recent report')
    .replace(/\ban?\s+article\s+of\s+the\s+berliner[-\s]?zeitung\b/gi, 'a recent report')
    .replace(/\ban?\s+article\s+from\s+the\s+berliner[-\s]?zeitung\b/gi, 'a recent report')
    .replace(/\bthe\s+new york times\b/gi, 'a major outlet')
    .replace(/\bnytimes\b/gi, 'a major outlet')
    .replace(/\bberliner[-\s]?zeitung\b/gi, 'a local outlet')
}

function sanitizeArticleSourceMentions(article: GeneratedArticle): GeneratedArticle {
  return {
    ...article,
    headline: sanitizeForbiddenSourceMentions(article.headline),
    subheadline:
      typeof article.subheadline === 'string'
        ? sanitizeForbiddenSourceMentions(article.subheadline)
        : article.subheadline,
    excerpt:
      typeof article.excerpt === 'string'
        ? sanitizeForbiddenSourceMentions(article.excerpt)
        : article.excerpt,
    bodyMarkdown: sanitizeForbiddenSourceMentions(article.bodyMarkdown),
  }
}

const META_SURREAL_PATTERNS: RegExp[] = [
  /\b(?:now|here(?:'s| is)?)\s+the\s+surreal\s+part\b[:,-]*/gi,
  /\b(?:the|this)\s+(?:surreal|absurd)\s+part\b[:,-]*/gi,
  /\b(?:then|and then|at that point)\s+it\s+(?:got|became|turned)\s+(?:surreal|absurd)\b[,:;-]*/gi,
  /\bin an?\s+(?:surreal|absurd)\s+twist\b[,:;-]*/gi,
  /\bas if things?\s+(?:weren't|were not)\s+weird enough\b[,:;-]*/gi,
]

function sanitizeMetaSurrealText(text: string): string {
  let out = text
  for (const pattern of META_SURREAL_PATTERNS) {
    out = out.replace(pattern, '')
  }
  out = out.replace(/[ \t]{2,}/g, ' ')
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

function sanitizeMetaSurrealFraming(article: GeneratedArticle): GeneratedArticle {
  return {
    ...article,
    headline: sanitizeMetaSurrealText(article.headline),
    subheadline:
      typeof article.subheadline === 'string'
        ? sanitizeMetaSurrealText(article.subheadline)
        : article.subheadline,
    excerpt:
      typeof article.excerpt === 'string'
        ? sanitizeMetaSurrealText(article.excerpt)
        : article.excerpt,
    bodyMarkdown: sanitizeMetaSurrealText(article.bodyMarkdown),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeCanonicalAttributionMentions(article: GeneratedArticle): GeneratedArticle {
  const canonicalAuthor = article.canonicalSourceAuthor?.trim()
  const canonicalStory = article.canonicalSourceStory?.trim()
  if (!canonicalAuthor && !canonicalStory) return article

  const scrub = (text: string): string => {
    let out = text

    // Remove explicit adaptation callouts in visible text while preserving the story itself.
    out = out.replace(
      /\b(?:a|an)?\s*(?:loose|modern|direct|free|wedding|berlin|satirical)?\s*adaptation of [^,.\n]+/gi,
      'a local reinterpretation',
    )
    out = out.replace(/\bbased on [^,.\n]+/gi, 'inspired by a classic template')

    if (canonicalAuthor) {
      out = out.replace(new RegExp(escapeRegExp(canonicalAuthor), 'gi'), 'a canonical author')
    }
    if (canonicalStory) {
      out = out.replace(new RegExp(escapeRegExp(canonicalStory), 'gi'), 'a canonical work')
    }

    return out
  }

  return {
    ...article,
    headline: scrub(article.headline),
    subheadline:
      typeof article.subheadline === 'string' ? scrub(article.subheadline) : article.subheadline,
    excerpt: typeof article.excerpt === 'string' ? scrub(article.excerpt) : article.excerpt,
    bodyMarkdown: scrub(article.bodyMarkdown),
  }
}

const AFR_EXPLANATION = 'AfR (Alternativ für Ratten)'
const AFR_EXPLANATION_PATTERN = /\bAfR\s*\(\s*Alternativ\s+f(?:u|ü)r\s+Ratten\s*\)/i
const AFR_SHORT_PATTERN = /\bAfR\b/i

function ensureAfRExplanationInNonHeadlineText(
  article: GeneratedArticle,
  opts?: { force?: boolean },
): GeneratedArticle {
  const force = opts?.force ?? false
  const nonHeadlineFields: Array<keyof GeneratedArticle> = [
    'subheadline',
    'excerpt',
    'bodyMarkdown',
    'imageCaption',
  ]

  const getText = (key: keyof GeneratedArticle): string =>
    typeof article[key] === 'string' ? (article[key] as string) : ''

  const hasExpandedAfR = nonHeadlineFields.some((key) => AFR_EXPLANATION_PATTERN.test(getText(key)))
  if (hasExpandedAfR) return article

  const hasAfRReference = nonHeadlineFields.some((key) => AFR_SHORT_PATTERN.test(getText(key)))
  if (hasAfRReference) {
    // Expand the first non-headline AfR mention; never touch the headline.
    for (const key of nonHeadlineFields) {
      const value = getText(key)
      if (!AFR_SHORT_PATTERN.test(value)) continue
      return {
        ...article,
        [key]: value.replace(/\bAfR\b/, AFR_EXPLANATION),
      }
    }
  }

  if (!force) return article

  return {
    ...article,
    bodyMarkdown: `${article.bodyMarkdown}\n\nThe ${AFR_EXPLANATION} remained central to the dispute.`,
  }
}

/**
 * Returns true if the RSS topic line overlaps too much with recent article titles
 * or the blacklist summary (same story already covered). Used to avoid assigning
 * an RSS topic that we have already satirized (e.g. "47 bikes / scooters").
 */
export function rssTopicOverlapsBlacklist(params: {
  rssTopicLine: string
  recentArticleTitles: string[]
  blacklistSummary: string
  minOverlapWords?: number
}): boolean {
  const { rssTopicLine, recentArticleTitles, blacklistSummary, minOverlapWords = 2 } = params
  const topicWords = getSignificantWords(normalizeRssTopicLine(rssTopicLine))
  if (topicWords.size === 0) return false

  const blacklistText = [...recentArticleTitles, blacklistSummary].join(' ')
  const blacklistWords = getSignificantWords(blacklistText)

  let overlap = 0
  for (const w of topicWords) {
    if (blacklistWords.has(w)) overlap += 1
    if (overlap >= minOverlapWords) return true
  }
  return false
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

function resolveToneProfile(raw: string | undefined): ToneProfile {
  const normalized = (raw ?? 'acidic').trim().toLowerCase()
  if (normalized === 'balanced' || normalized === 'acidic' || normalized === 'merciless') {
    return normalized
  }
  return 'acidic'
}

function clampScore(value: number, min = 1, max = 10): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function isFlagEnabled(raw: string | undefined, defaultValue = false): boolean {
  if (raw == null) return defaultValue
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return defaultValue
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function buildSatireBriefSection(brief: SatireBrief | null): string {
  if (!brief) {
    return [
      'SATIRE BRIEF (fallback):',
      '- Target specific institutions and social hypocrisy, not identity groups.',
      '- Include criticism that can sting right-wing posturing and left-wing performativity in the same piece.',
      '- Keep the comedy uncomfortable, concrete, and socially observant.',
    ].join('\n')
  }

  return [
    'SATIRE BRIEF (MANDATORY - USE THESE ANCHORS):',
    `- Discomfort thesis: ${brief.discomfortThesis}`,
    `- Institutional target: ${brief.institutionTarget}`,
    `- Hypocrisy mechanism to expose: ${brief.hypocrisyMechanism}`,
    `- Right-leaning jab to include: ${brief.rightWingJab}`,
    `- Left-leaning jab to include: ${brief.leftWingJab}`,
    '- Required concrete details:',
    ...brief.requiredConcreteDetails.map((d) => `  * ${d}`),
    '- Forbidden cheap shots:',
    ...brief.forbiddenCheapShots.map((d) => `  * ${d}`),
  ].join('\n')
}

async function generateSatireBrief(args: {
  apiKey: string
  modelName: string
  toneProfile: ToneProfile
  topicContext: string
  recentTitles: string[]
  blacklistSummary: string
  useFeatureStoryPrompt: boolean
  selectedRssTopic: string | null
  randomFocus: string
  includeBerlinThemes: boolean
}): Promise<SatireBrief | null> {
  const briefModelName = process.env.OPENAI_BRIEF_MODEL ?? args.modelName
  const llm = new ChatOpenAI({
    apiKey: args.apiKey,
    model: briefModelName,
    temperature: 1,
  })

  const recentTitles = args.recentTitles
    .slice(0, 8)
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n')

  const systemPrompt = [
    'You are an editorial strategist creating a SATIRE BRIEF for one article.',
    'Output MUST be strict JSON only.',
    'Focus on dark humor and political criticism grounded in social observation.',
    'Critique institutions, ideologies, and behaviors; avoid slurs, hate speech, and calls for harm.',
    `Tone profile guidance: ${TONE_PROFILE_GUIDANCE[args.toneProfile]}`,
    '',
    args.includeBerlinThemes ? WEDDING_REMINDER_SHORT : '',
  ].join('\n')

  const userPrompt = [
    'Create a brief that forces uncomfortable satire with political bite.',
    '',
    'Context:',
    `- Topic context: ${args.topicContext}`,
    `- Feature/news style: ${args.useFeatureStoryPrompt ? 'yes' : 'no'}`,
    `- RSS topic (if any): ${args.selectedRssTopic ?? 'none'}`,
    `- Focus direction: ${args.randomFocus}`,
    '',
    recentTitles.length > 0 ? ['Recent titles (avoid overlap):', recentTitles, ''].join('\n') : '',
    args.blacklistSummary.length > 0
      ? ['Blacklist summary (hard avoid):', args.blacklistSummary.slice(0, 2500), ''].join('\n')
      : '',
    'JSON schema:',
    '{',
    '  "discomfortThesis": string,',
    '  "institutionTarget": string,',
    '  "hypocrisyMechanism": string,',
    '  "rightWingJab": string,',
    '  "leftWingJab": string,',
    '  "requiredConcreteDetails": string[],',
    '  "forbiddenCheapShots": string[]',
    '}',
    '',
    'Requirements:',
    '- rightWingJab and leftWingJab must both be included and be specific.',
    '- requiredConcreteDetails must contain 2-6 tangible details to anchor realism.',
    '- forbiddenCheapShots must contain lazy joke patterns to avoid.',
    '- Keep this strategic and practical. No essay.',
  ].join('\n')

  try {
    const raw = await llm.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ])

    const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
    const jsonText = extractFirstJsonObject(text)
    const parsed = JSON.parse(jsonText) as unknown
    const validation = SatireBriefSchema.safeParse(parsed)
    if (!validation.success) return null
    return validation.data
  } catch {
    return null
  }
}

async function critiqueSatireArticle(args: {
  apiKey: string
  modelName: string
  toneProfile: ToneProfile
  article: GeneratedArticle
  brief: SatireBrief | null
  includeBerlinThemes: boolean
}): Promise<SatireCritique | null> {
  const criticModelName =
    process.env.OPENAI_CRITIC_MODEL ??
    process.env.OPENAI_REPAIR_MODEL ??
    process.env.OPENAI_MODEL ??
    args.modelName

  const llm = new ChatOpenAI({
    apiKey: args.apiKey,
    model: criticModelName,
    temperature: 0,
  })

  const systemPrompt = [
    'You are a satire editor scoring an article for darkness and political criticism.',
    'Output MUST be strict JSON only.',
    'Do not sanitize. Judge based on writing quality and satirical sharpness.',
    'Penalize vagueness and generic absurdism. Reward specificity and social observation.',
    'No score inflation.',
    '',
    args.includeBerlinThemes ? WEDDING_REMINDER_SHORT : '',
    args.includeBerlinThemes
      ? 'CRITICAL: If this article is about wedding ceremonies instead of the Wedding neighborhood, flag it harshly in the critique.'
      : '',
  ].join('\n')

  const userPrompt = [
    `Tone profile target: ${args.toneProfile} (${TONE_PROFILE_GUIDANCE[args.toneProfile]})`,
    '',
    args.brief
      ? ['Original satire brief (target state):', JSON.stringify(args.brief), ''].join('\n')
      : '',
    'Article JSON to evaluate:',
    JSON.stringify(args.article),
    '',
    'Score each dimension from 1-10:',
    '- darknessScore: how cynical / uncomfortable the satire is',
    '- politicalCriticismScore: how sharp the ideological/institutional critique is',
    '- discomfortScore: how much the reader feels called out',
    '- specificityScore: concrete detail and social precision',
    '',
    'JSON schema:',
    '{',
    '  "darknessScore": number,',
    '  "politicalCriticismScore": number,',
    '  "discomfortScore": number,',
    '  "specificityScore": number,',
    '  "passes": boolean,',
    '  "strongestLine": string,',
    '  "weaknesses": string[],',
    '  "revisionInstructions": string[]',
    '}',
    '',
    'Set passes=true only if ALL scores are at least 7.',
    'revisionInstructions should be concrete and directly actionable.',
  ].join('\n')

  try {
    const raw = await llm.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ])
    const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
    const jsonText = extractFirstJsonObject(text)
    const parsed = JSON.parse(jsonText) as unknown
    const validation = SatireCritiqueSchema.safeParse(parsed)
    if (!validation.success) {
      const issues = validation.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join(' | ')
      console.warn(`${LOG.prefix} Critique output schema mismatch: ${issues}`)
      return null
    }
    return validation.data
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`${LOG.prefix} Critique model request failed: ${message}`)
    return null
  }
}

function shouldRewriteFromCritique(critique: SatireCritique, minScore: number): boolean {
  const scoreFloor = clampScore(minScore)
  return (
    !critique.passes ||
    critique.darknessScore < scoreFloor ||
    critique.politicalCriticismScore < scoreFloor ||
    critique.discomfortScore < scoreFloor ||
    critique.specificityScore < Math.max(6, scoreFloor - 1)
  )
}

async function rewriteArticleFromCritique(args: {
  apiKey: string
  modelName: string
  article: GeneratedArticle
  critique: SatireCritique
  brief: SatireBrief | null
  toneProfile: ToneProfile
  categories: GeneratorCategoryOption[]
  authors: GeneratorAuthorOption[]
  includeBerlinThemes: boolean
}): Promise<GeneratedArticle> {
  const rewriteModelName = process.env.OPENAI_REWRITE_MODEL ?? args.modelName
  const llm = new ChatOpenAI({
    apiKey: args.apiKey,
    model: rewriteModelName,
    temperature: 0.9,
  })

  const categoriesList = safeStringList(args.categories)
  const authorsList = safeStringList(args.authors)

  const systemPrompt = [
    'You are rewriting an existing satirical article JSON to increase dark political bite.',
    'Make targeted edits. Preserve the core premise, setting, and structure unless critique says otherwise.',
    'Do NOT flatten voice. Keep or increase sarcasm and cynicism.',
    'Target institutions and ideology performance, not identity-based attacks.',
    'No slurs, hate speech, or calls for harm.',
    'Output MUST be strict JSON only.',
    '',
    args.includeBerlinThemes ? WEDDING_REMINDER_SHORT : '',
    args.includeBerlinThemes
      ? 'If the article is about wedding ceremonies, you MUST rewrite it to be about the Wedding neighborhood instead.'
      : '',
  ].join('\n')

  const userPrompt = [
    `Tone profile target: ${args.toneProfile} (${TONE_PROFILE_GUIDANCE[args.toneProfile]})`,
    '',
    args.brief ? ['Original satire brief:', JSON.stringify(args.brief), ''].join('\n') : '',
    'Critique scores and plan:',
    JSON.stringify(args.critique),
    '',
    'Existing categorySlug options (or create new):',
    categoriesList,
    '',
    'Existing authorSlug options (or create new with required fields):',
    authorsList,
    '',
    'Required JSON schema:',
    JSON_SCHEMA,
    '',
    'Article to rewrite:',
    JSON.stringify(args.article),
    '',
    'CRITICAL RULES:',
    '- Keep valid JSON schema.',
    '- Apply the revisionInstructions directly.',
    '- Increase specificity: names, places, observable behavior.',
    '- Keep the piece uncomfortable and politically critical in both directions.',
    '- Preserve category/author unless clearly incompatible with revised content.',
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  const jsonText = extractFirstJsonObject(text)
  const parsed = JSON.parse(jsonText) as unknown
  const validation = GeneratedArticleSchema.safeParse(parsed)
  if (validation.success) return validation.data

  return await repairToSchema({
    badOutput: text,
    categories: args.categories,
    authors: args.authors,
    validationErrors: validation.error.issues,
  })
}

function looksNonEnglish(text: string): boolean {
  // Detect substantial German language usage, not isolated names with umlauts.
  const lower = text.toLowerCase()
  const germanMarkers = ['der', 'die', 'das', 'und', 'nicht', 'ist', 'mit', 'für', 'im', 'auf']
  const markerHits = germanMarkers.filter((word) =>
    new RegExp(`\\b${word}\\b`, 'i').test(lower),
  ).length
  const germanWordMatches =
    lower.match(
      /\b(der|die|das|und|nicht|ist|mit|für|fuer|im|auf|ein|eine|den|dem|des|aber|auch)\b/g,
    )?.length ?? 0
  const totalWords = lower.split(/\s+/).filter(Boolean).length
  if (totalWords === 0) return false
  const germanDensity = germanWordMatches / totalWords
  const hasUmlaut = /[äöüß]/i.test(text)
  if (markerHits >= 2) return true
  if (germanDensity >= 0.12) return true
  if (hasUmlaut && (markerHits >= 1 || germanDensity >= 0.08)) return true
  return false
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
    'You are a translation-and-structure tool for satirical article JSON.',
    'Translate to US English while preserving the exact comedic voice, cynicism, and political criticism.',
    'Output MUST be strict JSON only, no markdown fences, no extra text.',
    'Rules:',
    '- Make MINIMAL edits. Do not rewrite style unless needed for translation.',
    '- categorySlug can be existing OR new.',
    '- authorSlug can be existing OR new. If new, you MUST provide newAuthorName, newAuthorTitle, newAuthorBio.',
    '- If the input has a new authorSlug but is missing newAuthorName/Title/Bio, GENERATE them based on the slug.',
    '- Keep the same JSON schema and field types.',
    '- Ensure bodyMarkdown is English markdown (no code blocks).',
    '- Preserve and translate newAuthorName, newAuthorTitle, newAuthorBio if present.',
    '- Keep controversial satire if policy-safe; do not sanitize by default.',
    '',
    WEDDING_REMINDER_SHORT,
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
    'Translate this JSON to US English (minimal edits, preserve tone and political bite, ensure new author fields if needed):',
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
  outputSchemaMode?: OutputSchemaMode
  seedDraft?: GenerateArticleInput['seedDraft']
  usedRssTopic?: string | null
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
    'You are a JSON repair tool for satirical article outputs.',
    'You will be given malformed or schema-invalid content produced by another model.',
    'Your job is to output STRICT JSON that matches the required schema.',
    'Rules:',
    '- Output JSON only (no markdown fences, no extra commentary).',
    '- Preserve original wording, style, sarcasm, and political criticism whenever possible.',
    '- Use SURGICAL edits only. Change only what is required to make schema-valid JSON.',
    '- All text fields must be in US English.',
    '- categorySlug can be an existing one OR a new category slug (lowercase, hyphens).',
    '- authorSlug can be an existing one OR a new author slug. If the authorSlug is NOT in the existing list, you MUST provide newAuthorName, newAuthorTitle, AND newAuthorBio.',
    '- If the input has a new authorSlug but is missing newAuthorName/newAuthorTitle/newAuthorBio, you MUST GENERATE them based on the slug and article context.',
    '- Ensure bodyMarkdown is a single markdown string (no code blocks).',
    '- Respect ALL max-length limits; rewrite text to fit without truncating mid-word.',
    '- Do not sanitize edgy political satire unless required to remove explicit policy violations.',
    '',
    WEDDING_REMINDER_SHORT,
  ].join('\n')

  const validationErrorsSection =
    args.validationErrors && args.validationErrors.length > 0
      ? ['Validation errors to fix:', formatZodIssues(args.validationErrors), ''].join('\n')
      : ''
  const outputSchemaMode = args.outputSchemaMode ?? 'full'
  const schemaBlock =
    outputSchemaMode === 'body-only-locked-draft' ? JSON_SCHEMA_BODY_ONLY : JSON_SCHEMA

  const userPrompt = [
    'Existing categorySlug options (or create new):',
    categoriesList,
    '',
    'Existing authorSlug options (or create new with required fields):',
    authorsList,
    '',
    outputSchemaMode === 'body-only-locked-draft'
      ? 'LOCKED DRAFT MODE: headline/subheadline/excerpt/sourceRssTopic are server-locked; DO NOT return them.'
      : '',
    '',
    'Required JSON schema:',
    schemaBlock,
    '',
    'CRITICAL: If authorSlug is NOT in the existing list, you MUST provide newAuthorName, newAuthorTitle, AND newAuthorBio. Generate them based on the slug and article context if missing.',
    '',
    validationErrorsSection,
    'Bad output to repair (preserve tone; edit minimally):',
    args.badOutput,
  ].join('\n')

  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  const jsonText = extractFirstJsonObject(text)
  const parsed = JSON.parse(jsonText) as unknown
  const hydratedForValidation =
    outputSchemaMode === 'body-only-locked-draft'
      ? hydrateLockedDraftFields({
          output: parsed,
          seedDraft: args.seedDraft,
          usedRssTopic: args.usedRssTopic ?? null,
        })
      : parsed
  const validation = GeneratedArticleSchema.safeParse(hydratedForValidation)
  if (validation.success) {
    return validation.data
  }

  if (hasTooBigIssues(validation.error.issues)) {
    return await shortenToSchema({
      bad: parsed,
      categories: args.categories,
      authors: args.authors,
      issues: validation.error.issues,
      outputSchemaMode,
      seedDraft: args.seedDraft,
      usedRssTopic: args.usedRssTopic ?? null,
    })
  }

  throw validation.error
}

async function shortenToSchema(args: {
  bad: unknown
  categories: GeneratorCategoryOption[]
  authors: GeneratorAuthorOption[]
  issues: z.ZodIssue[]
  outputSchemaMode?: OutputSchemaMode
  seedDraft?: GenerateArticleInput['seedDraft']
  usedRssTopic?: string | null
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
  const outputSchemaMode = args.outputSchemaMode ?? 'full'
  const schemaBlock =
    outputSchemaMode === 'body-only-locked-draft' ? JSON_SCHEMA_BODY_ONLY : JSON_SCHEMA

  const systemPrompt = [
    'You are a copy editor for JSON outputs.',
    'Shorten ONLY the fields listed to meet max length limits.',
    'Do not truncate mid-word; rewrite to fit while preserving meaning and tone.',
    'Use minimal edits. Keep sarcasm and political criticism intact.',
    'Output MUST be strict JSON only, no markdown fences, no extra text.',
    'categorySlug can be existing OR new. authorSlug can be existing OR new (if new, ensure newAuthorName/Title/Bio are provided).',
    'If the input has a new authorSlug but is missing newAuthorName/Title/Bio, GENERATE them based on the slug.',
    '',
    WEDDING_REMINDER_SHORT,
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
    outputSchemaMode === 'body-only-locked-draft'
      ? 'LOCKED DRAFT MODE: headline/subheadline/excerpt/sourceRssTopic are server-locked; DO NOT return them.'
      : '',
    '',
    'JSON schema:',
    schemaBlock,
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
  const hydratedForValidation =
    outputSchemaMode === 'body-only-locked-draft'
      ? hydrateLockedDraftFields({
          output: parsed,
          seedDraft: args.seedDraft,
          usedRssTopic: args.usedRssTopic ?? null,
        })
      : parsed
  const validation = GeneratedArticleSchema.safeParse(hydratedForValidation)

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
    temperature: 1,
  })

  const bannedWordsLower = args.bannedOpeningWords.map((w) => w.toLowerCase())
  const currentFirstWord =
    args.article.headline
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? ''

  const systemPrompt = [
    'You are a headline editor for a satirical newspaper called "The Wedding Times".',
    'Your ONLY job is to rewrite a headline that violates structural rules.',
    'You must preserve the meaning and tone but change the STRUCTURE (especially the opening word).',
    '',
    'CRITICAL: "Wedding" refers to the Wedding neighborhood in Berlin, NOT wedding ceremonies.',
    'The headline must NEVER be about wedding ceremonies, marriage, brides, grooms, or wedding planning.',
    'If the headline is about wedding ceremonies, rewrite it to be about the Wedding neighborhood instead.',
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

function applySeedDraft(
  article: GeneratedArticle,
  seed: GenerateArticleInput['seedDraft'] | undefined,
): GeneratedArticle {
  if (!seed) return article

  const next = {
    ...article,
    headline: seed.headline.trim().slice(0, 140),
  }

  if (typeof seed.subheadline === 'string') {
    next.subheadline = seed.subheadline.trim().slice(0, 220) || null
  }
  if (typeof seed.excerpt === 'string') {
    next.excerpt = normalizeExcerptForStorage(seed.excerpt, 300) || null
  }

  return next
}

function resolveOutputSchemaMode(input: GenerateArticleInput): OutputSchemaMode {
  if (input.seedDraft?.headline?.trim()) {
    return 'body-only-locked-draft'
  }
  return 'full'
}

function hydrateLockedDraftFields(args: {
  output: unknown
  seedDraft: GenerateArticleInput['seedDraft'] | undefined
  usedRssTopic: string | null
}): unknown {
  if (!args.seedDraft?.headline?.trim()) return args.output
  if (!args.output || typeof args.output !== 'object' || Array.isArray(args.output)) {
    return args.output
  }

  const hydrated: Record<string, unknown> = {
    ...(args.output as Record<string, unknown>),
    headline: args.seedDraft.headline.trim().slice(0, 140),
  }

  hydrated.subheadline =
    typeof args.seedDraft.subheadline === 'string'
      ? args.seedDraft.subheadline.trim().slice(0, 220) || null
      : null
  hydrated.excerpt =
    typeof args.seedDraft.excerpt === 'string'
      ? normalizeExcerptForStorage(args.seedDraft.excerpt, 300) || null
      : null
  hydrated.sourceRssTopic = args.usedRssTopic ?? null

  return hydrated
}

function finalizeGeneratedExcerpt(article: GeneratedArticle): GeneratedArticle {
  if (typeof article.excerpt !== 'string') return article
  return {
    ...article,
    excerpt: normalizeExcerptForStorage(article.excerpt, 300) || null,
  }
}

function enforceSourceRssTopic(
  article: GeneratedArticle,
  usedRssTopic: string | null,
): GeneratedArticle {
  const normalized = usedRssTopic?.trim() ?? ''
  return {
    ...article,
    sourceRssTopic:
      normalized.length > 0 ? normalized.slice(0, SOURCE_RSS_TOPIC_MAX).trim() || null : null,
  }
}

/******************* MAIN ***********************/

export async function generateArticle(input: GenerateArticleInput): Promise<GenerateArticleResult> {
  LOG.step('STEP 1: generateArticle started')
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const modelName = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
  const toneProfile = resolveToneProfile(process.env.OPENAI_TONE_PROFILE)
  const minCritiqueScore = clampScore(Number(process.env.SATIRE_MIN_CRITIQUE_SCORE ?? '7'))
  const briefEnabled = isFlagEnabled(process.env.SATIRE_BRIEF_ENABLED, false)
  const critiqueEnabled = isFlagEnabled(process.env.SATIRE_CRITIQUE_ENABLED, false)
  const outputSchemaMode = resolveOutputSchemaMode(input)
  const seedDraftTopicHint = input.seedDraft?.topicHint?.trim() || null
  const useRandomModes = input.manualOverrides?.useRandomModes !== false
  const includeBerlinThemes = input.manualOverrides?.includeBerlinThemes !== false
  const strictTopicFocus = input.manualOverrides?.strictTopicFocus === true
  console.log(`${LOG.prefix} Model: ${modelName}`)
  console.log(
    `${LOG.prefix} Tone profile: ${toneProfile} | min critique score: ${minCritiqueScore}`,
  )
  console.log(
    `${LOG.prefix} Manual overrides | random=${useRandomModes} berlinThemes=${includeBerlinThemes} strictTopicFocus=${strictTopicFocus}`,
  )
  if (outputSchemaMode === 'body-only-locked-draft') {
    console.log(
      `${LOG.prefix} Locked-draft mode active: headline/subheadline/excerpt are server-owned`,
    )
  }

  const llm = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 1,
  })

  // 33% chance to use the new feature/soft news/local/crime/news story prompt type
  // When forceRss or forceOpinion is true, skip feature story
  let useFeatureStoryPrompt =
    input.forceRss || input.forceOpinion ? false : useRandomModes && Math.random() < 0.33
  // 30% chance to force a canonical Western-story adaptation for non-opinion pieces
  let useCanonicalWeddingStoryStructure =
    !input.forceOpinion && useRandomModes && Math.random() < 0.3

  if (input.seedDraft?.headline?.trim()) {
    // Keep continuity with accepted draft by disabling style pivots that can change premise.
    useFeatureStoryPrompt = false
    useCanonicalWeddingStoryStructure = false
  }

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
  const selectedStoryType = pickFromList(storyTypes, useRandomModes)

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
    'A Wedding street-cleaning pilot that promises weekly cleanup, delivers monthly, and publishes celebratory reports anyway',
    'A Bürgeramt help desk in Wedding where every answer starts with a sigh and ends with a different form',
    'A Hausarzt waiting room in Wedding where patients with appointments now bring lunch and phone chargers',
    'Berlin weather office confirms 31 consecutive days of identical gray sky and "light emotional drizzle"',
    'The district hotline that keeps callers on hold for 40 minutes before recommending they send a fax',
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
    // AfR recurring political satire stories
    'Alternativ für Ratten (AfR) opens a campaign office in Wedding sewers, promising "traditional tunnel values"',
    'Alice Rattenweidel launches an anti-immigrant platform blaming all municipal failures on "new rats from outside the district"',
    'AfR unveils a pro-Russia foreign policy paper printed on stolen Bürgeramt forms',
    'AfR demands immediate exit from the EU while accepting every available EU neighborhood subsidy',
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
    'Kater Blau garden bonfire smoke triggers building evacuation next door, attendees assume it is part of the ambiance',
  ]

  // DRUGS AND TECHNO scenarios
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

  // STARTUP AND GENTRIFICATION scenarios
  const startupAndGentrificationScenarios = concreteBerlinScenarios.filter(
    (scenario) =>
      !drugsAndTechnoScenarios.includes(scenario) &&
      (scenario.includes('gentrification') ||
        scenario.includes('hipster') ||
        scenario.includes('startup') ||
        scenario.includes('co-working') ||
        scenario.includes('yoga') ||
        scenario.includes('vegan') ||
        scenario.includes('expat') ||
        scenario.includes('organic') ||
        scenario.includes('vape shop') ||
        scenario.includes('craft cocktail') ||
        scenario.includes('brunch') ||
        scenario.includes('artisanal') ||
        scenario.includes('only serves food to people who can prove')),
  )

  // Three-way scenario selection: drugs/techno, startup, or general
  // Can be overridden by forceDrugsTechno / forceStartup parameters
  let useDrugsOrTechnoScenario: boolean
  let useStartupScenario: boolean

  if (input.forceDrugsTechno === true) {
    useDrugsOrTechnoScenario = true
    useStartupScenario = false
  } else if (input.forceStartup === true) {
    useDrugsOrTechnoScenario = false
    useStartupScenario = true
  } else if (input.forceDrugsTechno === false && input.forceStartup === false) {
    useDrugsOrTechnoScenario = false
    useStartupScenario = false
  } else if (!useRandomModes) {
    useDrugsOrTechnoScenario = false
    useStartupScenario = false
  } else {
    // Random: 20% drugs/techno, 10% startup, 70% general
    const scenarioRoll = Math.random()
    useDrugsOrTechnoScenario = scenarioRoll < 0.2
    useStartupScenario = !useDrugsOrTechnoScenario && scenarioRoll < 0.3
  }

  // General pool: neither drugs/techno nor startup
  const generalScenarios = concreteBerlinScenarios.filter(
    (scenario) =>
      !drugsAndTechnoScenarios.includes(scenario) &&
      !startupAndGentrificationScenarios.includes(scenario),
  )

  let selectedScenario = useDrugsOrTechnoScenario
    ? pickFromList(drugsAndTechnoScenarios, useRandomModes)
    : useStartupScenario
      ? pickFromList(startupAndGentrificationScenarios, useRandomModes)
      : pickFromList(generalScenarios, useRandomModes)

  // Randomly pick a topic focus to force variety (aligned with site categories)
  const topicFocuses = [
    // Bureaucracy
    'Bürgeramt nightmares, appointment systems, or German paperwork hell',
    'Berlin bureaucracy, forms in triplicate, or civil servant attitudes',
    'the sadistic joy German officials take in rejecting incomplete forms',
    'administrative slowness where each missing stamp adds two more weeks to your life',
    'public-office rudeness treated as an efficiency feature, not a communication failure',
    'the Berlin permit process: one request, seven desks, zero outcomes this quarter',
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
    'the economics of club stamps (ink stamps, NOT wristbands): why people protect them like investments',
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
    // AfR recurring political satire
    'Alternativ für Ratten (AfR), Alice Rattenweidel, and far-right rat politics in Berlin',
    'AfR anti-immigrant rhetoric, racist dog whistles, and culture-war panic in Wedding',
    'AfR pro-Russia messaging, anti-EU campaigns, and opportunistic nationalist theater',
    'the latest AfR party developments: scandals, rallies, internal feuds, and fear-based campaigns',
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
    'the parallel economy of Berlin club stamps (ink stamps on your hand/arm — NOT wristbands)',
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
    'BVG strikes, sudden cancellations, and "service disruption" as a permanent state',
    'endless BVG construction projects that move platforms but solve nothing',
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
    'Germanys sacred sick note culture: one mild symptom, one full week off',
    'the national productivity theater: everyone is busy, nothing gets done',
    'colleagues who are "out sick" all week and return with fresh brunch recommendations',
    'Berlin weather: nine months of gray drizzle, two weeks of panic heat, and no transition period',
    'customer service that starts with a sigh and ends with "not my department"',
    'sidewalk obstacle courses of dog shit, broken glass, and mysterious puddles',
    'dating in Berlin, Tinder culture, or relationship chaos',
    'Berlin drug culture, club bathroom discoveries, or ketamine brunch',
    'Berlin decadence, after-parties that last days, or hedonistic lifestyle',
    'Berlin filth, lack of street cleaning, overflowing trash, or rat sightings',
    'Görlitzer Park shenanigans, dealer diplomacy, or park culture',
    // Health system & family infrastructure
    'the German health system: impossible appointments, paper forms, and digitalization cosplay',
    'waiting 3 hours with an appointment while the Praxis pretends time is a suggestion',
    'doctors who are rude, dismissive, and somehow still behind schedule by noon',
    'treatments that feel stuck between bureaucracy, folklore, and borderline non-science',
    'Facharzt referral ping-pong where each Praxis sends you to another Praxis',
    'health insurance hotlines that prescribe patience, tea, and waiting until next quarter',
    'Kita chaos: staff shortages, constant sick leave, and parents in permanent emergency mode',
    'Kitas that close early, cancel often, and call it reliable childcare',
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

  // DRUGS AND TECHNO topics
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

  // STARTUP AND GENTRIFICATION topics
  const startupAndGentrificationTopics = topicFocuses.filter(
    (topic) =>
      !drugsAndTechnoTopics.includes(topic) &&
      (topic.includes('startup') ||
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
        topic.includes('expat') ||
        topic.includes('rent') ||
        topic.includes('housing') ||
        topic.includes('Airbnb') ||
        topic.includes('WG') ||
        topic.includes('art scene') ||
        topic.includes('galleries closing')),
  )

  // General topics: neither drugs/techno nor startup/gentrification
  const generalTopics = topicFocuses.filter(
    (topic) =>
      !drugsAndTechnoTopics.includes(topic) && !startupAndGentrificationTopics.includes(topic),
  )

  // Three-way topic selection: drugs/techno, startup, or general
  // Same logic as scenario selection, mirrored for topics
  let useDrugsOrTechnoTopic: boolean
  let useStartupTopic: boolean

  if (input.forceDrugsTechno === true) {
    useDrugsOrTechnoTopic = true
    useStartupTopic = false
  } else if (input.forceStartup === true) {
    useDrugsOrTechnoTopic = false
    useStartupTopic = true
  } else if (input.forceDrugsTechno === false && input.forceStartup === false) {
    useDrugsOrTechnoTopic = false
    useStartupTopic = false
  } else if (!useRandomModes) {
    useDrugsOrTechnoTopic = false
    useStartupTopic = false
  } else {
    // Random: 20% drugs/techno, 15% startup, 65% general
    const topicRoll = Math.random()
    useDrugsOrTechnoTopic = topicRoll < 0.2
    useStartupTopic = !useDrugsOrTechnoTopic && topicRoll < 0.35
  }

  // Opinion-only topics (when forceOpinion is true)
  const opinionOnlyTopics = topicFocuses.filter((t) => t.startsWith('[OPINION]'))

  let randomFocus: string

  if (input.forceOpinion && opinionOnlyTopics.length > 0) {
    randomFocus = pickFromList(opinionOnlyTopics, useRandomModes)
  } else if (useDrugsOrTechnoTopic) {
    randomFocus = pickFromList(drugsAndTechnoTopics, useRandomModes)
  } else if (useStartupTopic) {
    randomFocus = pickFromList(startupAndGentrificationTopics, useRandomModes)
  } else {
    randomFocus = pickFromList(generalTopics, useRandomModes)
  }

  if (input.seedDraft?.headline?.trim()) {
    const lockedPremise = [input.seedDraft.headline, input.seedDraft.excerpt ?? '']
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join(' — ')
      .slice(0, 320)
    if (lockedPremise.length > 0) {
      randomFocus = lockedPremise
      selectedScenario = lockedPremise
    }
  }

  // Build blacklist (recent titles + summary) BEFORE selecting RSS topic so we can exclude
  // RSS topics that overlap with already-covered stories (e.g. same bikes/scooters story).
  const maxRecentArticles = 20
  const recentTitles = input.recentArticleTitles.slice(0, maxRecentArticles)
  const recentExcerpts = input.recentArticleExcerpts?.slice(0, maxRecentArticles) ?? []

  let recentArticlesSummary: string
  if (input.precomputedBlacklistSummary !== undefined) {
    recentArticlesSummary = input.precomputedBlacklistSummary
    if (recentArticlesSummary.length > 0) {
      console.log(
        `${LOG.prefix} Using precomputed blacklist summary (${recentArticlesSummary.length} chars)`,
      )
    }
  } else if (recentTitles.length > 0) {
    LOG.step('STEP 3: pre-analysis (summarize recent articles for blacklist)')
    recentArticlesSummary = await summarizeRecentArticlesForBlacklist({
      titles: recentTitles,
      excerpts: recentExcerpts,
      apiKey,
    })
    if (recentArticlesSummary.length > 0) {
      console.log(
        `${LOG.prefix} Pre-analysis SUCCESS | summary length: ${recentArticlesSummary.length} chars`,
      )
    } else {
      console.log(`${LOG.prefix} Pre-analysis returned empty (will use raw titles only)`)
    }
  } else {
    recentArticlesSummary = ''
  }

  // Deterministically avoid seed scenarios/topics that overlap with already-covered stories.
  // This prevents hardcoded seed ideas from overriding blacklist instructions.
  const recentCoverageReferences = buildRecentCoverageReferences({
    titles: recentTitles,
    excerpts: recentExcerpts,
    blacklistSummary: recentArticlesSummary,
    maxItems: 30,
  })
  if (recentCoverageReferences.length > 0) {
    const scenarioPool = useDrugsOrTechnoScenario
      ? drugsAndTechnoScenarios
      : useStartupScenario
        ? startupAndGentrificationScenarios
        : generalScenarios
    const filteredScenario = pickCandidateAvoidingRecentCoverage({
      candidates: scenarioPool,
      references: recentCoverageReferences,
      fallback: selectedScenario,
      label: 'scenario',
      useRandom: useRandomModes,
    })
    if (filteredScenario !== selectedScenario) {
      console.log(`${LOG.prefix} Replaced overlapping scenario seed with a fresher one`)
      selectedScenario = filteredScenario
    }

    const topicPool =
      input.forceOpinion && opinionOnlyTopics.length > 0
        ? opinionOnlyTopics
        : useDrugsOrTechnoTopic
          ? drugsAndTechnoTopics
          : useStartupTopic
            ? startupAndGentrificationTopics
            : generalTopics
    const filteredTopic = pickCandidateAvoidingRecentCoverage({
      candidates: topicPool,
      references: recentCoverageReferences,
      fallback: randomFocus,
      label: 'topic',
      useRandom: useRandomModes,
    })
    if (filteredTopic !== randomFocus) {
      console.log(`${LOG.prefix} Replaced overlapping topic seed with a fresher one`)
      randomFocus = filteredTopic
    }
  }

  // When RSS topics are available, pick one that does NOT overlap with the blacklist.
  // Otherwise we keep assigning the same real-world story (e.g. bikes/scooters) and the LLM
  // produces yet another variation of an article we told it to avoid.
  const topicSummaryLines = parseTopicSummary(input.topicSummary)
  const manualTopics = Array.from(
    new Set(
      topicSummaryLines
        .filter((line) => line.source === 'manual')
        .map((line) => line.value)
        .filter((line) => line.length > 0),
    ),
  )
  const rssTopicsRaw = topicSummaryLines
    .filter((line) => line.source === 'rss' || line.source === 'hint')
    .map((line) => line.value)
    .filter((line) => line.length > 0)
  const uniqueRssTopics = Array.from(new Set(rssTopicsRaw))
  const rssTopics =
    uniqueRssTopics.length > 0 && recentTitles.length > 0
      ? uniqueRssTopics.filter(
          (line) =>
            isAfDTopic(line) ||
            !rssTopicOverlapsBlacklist({
              rssTopicLine: line,
              recentArticleTitles: recentTitles,
              blacklistSummary: recentArticlesSummary,
              minOverlapWords: 2,
            }),
        )
      : uniqueRssTopics
  if (uniqueRssTopics.length > 0 && rssTopics.length < uniqueRssTopics.length) {
    console.log(
      `${LOG.prefix} Filtered ${uniqueRssTopics.length - rssTopics.length} RSS topic(s) that overlap blacklist`,
    )
  }
  const seedDraftRssTopicHint =
    seedDraftTopicHint && rssTopics.includes(seedDraftTopicHint) ? seedDraftTopicHint : null
  const seedDraftManualTopicHint =
    seedDraftTopicHint && !seedDraftRssTopicHint ? seedDraftTopicHint : null
  const effectiveManualTopics = seedDraftManualTopicHint
    ? Array.from(new Set([seedDraftManualTopicHint, ...manualTopics]))
    : manualTopics

  const hasRssTopics =
    (input.includeTopics && rssTopics.length > 0) || Boolean(seedDraftRssTopicHint)
  const afdTriggeredRssTopic = hasRssTopics ? rssTopics.find((topic) => isAfDTopic(topic)) : null
  const selectedRssTopic = seedDraftRssTopicHint
    ? seedDraftRssTopicHint
    : hasRssTopics
      ? (afdTriggeredRssTopic ?? pickFromList(rssTopics, useRandomModes))
      : null
  const selectedManualTopic =
    !selectedRssTopic && effectiveManualTopics.length > 0
      ? pickFromList(effectiveManualTopics, useRandomModes)
      : null
  if (selectedManualTopic) {
    randomFocus = selectedManualTopic
    selectedScenario = selectedManualTopic
  }
  if (strictTopicFocus && selectedRssTopic) {
    randomFocus = selectedRssTopic
    selectedScenario = selectedRssTopic
  }

  // Track whether RSS topic was ACTUALLY used in the prompt (not just selected)
  // RSS topics are only used when NOT a feature story AND RSS topics are available
  const actuallyUsedRssTopic =
    !useFeatureStoryPrompt && hasRssTopics && selectedRssTopic ? selectedRssTopic : null
  const useAfRRssMode = Boolean(actuallyUsedRssTopic && isAfDTopic(actuallyUsedRssTopic))

  LOG.step(
    `STEP 2: topic/scenario selected | featureStory=${useFeatureStoryPrompt} | rss=${!!actuallyUsedRssTopic} | afr=${useAfRRssMode} | drugsTechno=${useDrugsOrTechnoTopic || useDrugsOrTechnoScenario} | startup=${useStartupTopic || useStartupScenario}`,
  )
  if (actuallyUsedRssTopic) {
    console.log(`${LOG.prefix} RSS topic: ${actuallyUsedRssTopic.slice(0, 80)}...`)
  } else if (selectedManualTopic) {
    console.log(`${LOG.prefix} Manual topic: ${selectedManualTopic.slice(0, 80)}...`)
  }

  const rawTitlesBlock = recentTitles
    .map((title, idx) => {
      const excerpt = recentExcerpts[idx]
      const excerptText = excerpt
        ? ` — ${excerpt.length > 150 ? excerpt.slice(0, 147) + '...' : excerpt}`
        : ''
      return `  ${idx + 1}. "${title}"${excerptText}`
    })
    .join('\n')

  const recentTitlesSection =
    recentTitles.length > 0
      ? [
          '',
          '═══════════════════════════════════════════════════════════════════',
          'BLACKLIST - MANDATORY: DO NOT REPEAT ANY OF THIS. YOUR TOPIC MUST NOT OVERLAP.',
          '═══════════════════════════════════════════════════════════════════',
          '',
          'WARNING: The content below is FORBIDDEN. Do NOT use it as inspiration. Do NOT write',
          'variations, sequels, or the same joke from a different angle. Your story must be on a',
          'completely different subject. If your idea is even remotely similar to any premise below,',
          'pick something else.',
          '',
          recentArticlesSummary.length > 0
            ? [
                'An editorial assistant analyzed recent articles. EVERY item in the summary below is OFF-LIMITS.',
                'You MUST pick a topic, place, and premise that do NOT appear in this blacklist. If your idea overlaps, SCRAP IT.',
                '',
                '--- STRUCTURED BLACKLIST (places, topics, substances, jokes, overrepresented themes) ---',
                recentArticlesSummary,
                '',
                '--- RECENT ARTICLE TITLES (do not write anything similar in topic, angle, or joke) ---',
                rawTitlesBlock,
              ].join('\n')
            : [
                `The following ${recentTitles.length} articles were ALREADY PUBLISHED RECENTLY.`,
                'Your article MUST NOT overlap in topic, angle, joke, or premise.',
                '',
                rawTitlesBlock,
              ].join('\n'),
          '',
          'ABSOLUTE RULES:',
          '- Do NOT write about any PLACE listed above.',
          '- Do NOT write about any TOPIC listed above.',
          '- Do NOT mention any SUBSTANCE listed above.',
          '- Do NOT reuse any JOKE or PREMISE listed above, even from a different angle.',
          '- If a theme appears in OVERREPRESENTED, it is COMPLETELY off-limits.',
          '- Your headline and premise must be clearly distinct from every title above.',
          '- When in doubt, pick something that appears NOWHERE in the blacklist.',
          '═══════════════════════════════════════════════════════════════════',
        ].join('\n')
      : ''

  // Section showing the latest article's content to ensure the new one is different
  const latestArticleSection = input.latestArticleContentSample
    ? [
        '',
        '═══════════════════════════════════════════════════════════════════',
        'THE MOST RECENT ARTICLE (YOUR ARTICLE MUST BE NOTHING LIKE THIS)',
        '═══════════════════════════════════════════════════════════════════',
        '',
        'This is the article that was published RIGHT BEFORE yours.',
        'Your article must feel like it was written by a DIFFERENT person about a DIFFERENT world:',
        '- Completely different subject matter',
        '- Different writing approach and structure',
        '- Different characters, locations, situations',
        '- If this article is funny-absurd, yours should be funny-critical (or vice versa)',
        '',
        'CONTENT SAMPLE (this is what readers JUST read — do NOT give them more of the same):',
        '---',
        input.latestArticleContentSample,
        '---',
        '',
        'A reader who just finished the article above should feel SURPRISED by yours — not bored by similarity.',
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

  const useAfRTopicMode = useAfRRssMode || isAfRTheme(randomFocus) || isAfRTheme(selectedScenario)

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
        '- "On Tuesday, reportedly around 10:30 in the morning, Klaus Müller, 47, discovered that his Späti loyalty card had been replaced with a library card..."',
        '- "The incident occurred at the corner of Müllerstraße and Seestraße, where witnesses report seeing..."',
        '- "According to sources at the Wedding district office, the situation began when..."',
        '',
        'This is NOT an opinion piece or abstract satire. This is a NEWS STORY about something absurd but specific.',
      ].join('\n')
    : hasRssTopics && selectedRssTopic
      ? useAfRRssMode
        ? [
            'PRIMARY TOPIC SOURCE: This real-world headline references AfD.',
            'MANDATORY REFRAME: Write the story as a development about the fictional rat party "Alternativ für Ratten (AfR)", not AfD directly.',
            'Use the real headline as inspiration only; transform it into AfR political satire in Berlin.',
            `SECONDARY/BACKUP THEME (use only if the news topic is too narrow): ${randomFocus}`,
            AFR_RECURRING_STORY_RULES,
          ].join('\n')
        : [
            'PRIMARY TOPIC SOURCE: A real-world news headline will be provided. You MUST write a satirical Berlin angle on that news story.',
            `SECONDARY/BACKUP THEME (use only if the news topic is too narrow): ${randomFocus}`,
            'The real news topic takes PRIORITY - find a clever Berlin connection to it.',
          ].join('\n')
      : [
          `TOPIC DIRECTION (use as inspiration, NOT as your headline): ${randomFocus}`,
          'CRITICAL: The topic direction above is just a THEME to inspire you. DO NOT copy it as your headline. Create your OWN original, clever headline that relates to the theme but is distinctly different wording.',
        ].join('\n')
  const canonicalStructureInstruction = useCanonicalWeddingStoryStructure
    ? CANONICAL_WEDDING_STORY_STRUCTURE
    : ''
  const recentCanonicalReferencesSection =
    useCanonicalWeddingStoryStructure &&
    Array.isArray(input.recentCanonicalStoryReferences) &&
    input.recentCanonicalStoryReferences.length > 0
      ? [
          'RECENT CANONICAL REFERENCES (LAST 20) — AVOID REPETITION:',
          input.recentCanonicalStoryReferences
            .slice(0, 20)
            .map((ref, index) => `${index + 1}. ${ref.author} — ${ref.story}`)
            .join('\n'),
          '',
          'Do NOT reuse the same author+story pair from the list above.',
          'Prefer not to reuse the same source story at all.',
          'Try to vary both author/tradition and story whenever possible.',
        ].join('\n')
      : ''

  const topicContext = useFeatureStoryPrompt
    ? selectedScenario
    : hasRssTopics && selectedRssTopic
      ? selectedRssTopic
      : randomFocus
  const satireBrief = briefEnabled
    ? await generateSatireBrief({
        apiKey,
        modelName,
        toneProfile,
        topicContext,
        recentTitles,
        blacklistSummary: recentArticlesSummary,
        useFeatureStoryPrompt,
        selectedRssTopic,
        randomFocus,
        includeBerlinThemes,
      })
    : null
  const satireBriefSection = buildSatireBriefSection(satireBrief)
  if (!briefEnabled) {
    console.log(`${LOG.prefix} Satire brief disabled by SATIRE_BRIEF_ENABLED`)
  } else if (satireBrief) {
    console.log(
      `${LOG.prefix} Satire brief generated | institution target: ${satireBrief.institutionTarget}`,
    )
  } else {
    console.log(`${LOG.prefix} Satire brief generation failed; using fallback instructions`)
  }

  const systemPrompt = [
    includeBerlinThemes
      ? 'You are a satire writer for "The Wedding Times", a fictional satirical newspaper covering Berlin.'
      : 'You are a satire writer for a fictional satirical newspaper covering global current events.',
    'Language: write everything in US English (no German, no other languages).',
    `Tone profile: ${toneProfile.toUpperCase()} — ${TONE_PROFILE_GUIDANCE[toneProfile]}`,
    '',
    HUMOR_PERSPECTIVE_METHOD,
    '',
    '═══════════════════════════════════════════════════════════════════',
    'ABSOLUTE RULE — DO NOT USE ANY EXAMPLES FROM THIS PROMPT',
    '═══════════════════════════════════════════════════════════════════',
    'This prompt contains many examples (headlines, scenarios, jokes, innuendo phrases, surreal premises).',
    'These examples exist ONLY to show you the STYLE and TONE we want.',
    'You MUST NOT copy, reuse, paraphrase, or closely imitate ANY example from this prompt.',
    'Every headline, joke, scenario, and premise you write must be 100% ORIGINAL.',
    'If your output resembles any example from this prompt, it will be REJECTED.',
    '═══════════════════════════════════════════════════════════════════',
    '',
    includeBerlinThemes ? WEDDING_NEIGHBORHOOD_CONTEXT : '',
    '',
    includeBerlinThemes ? TURKISH_COMMUNITY_CONTEXT : '',
    '',
    // Use strong drugs/techno encouragement when that topic is selected, mild version otherwise
    includeBerlinThemes && (useDrugsOrTechnoTopic || useDrugsOrTechnoScenario)
      ? BERLIN_DRUGS_TECHNO_CULTURE_STRONG
      : includeBerlinThemes
        ? BERLIN_DRUGS_TECHNO_CULTURE_MILD
        : '',
    '',
    // Use strong startup/gentrification encouragement when that topic is selected, mild version otherwise
    includeBerlinThemes && (useStartupTopic || useStartupScenario)
      ? BERLIN_STARTUP_CULTURE_STRONG
      : includeBerlinThemes
        ? BERLIN_STARTUP_CULTURE_MILD
        : '',
    '',
    'WRITING STYLE NOTES:',
    '- Reduce usage of the word "vibes" or "vibe"—it is overused. Prefer more specific, evocative language.',
    '- Instead of "the vibe was off", try "the atmosphere felt wrong", "something was different", "the energy had shifted", etc.',
    '- Do NOT use overly precise clock times like "at 3:47pm" or "at 6:42 a.m." — they sound forced and robotic.',
    '- Instead use APPROXIMATE times: "around 9:40 am", "reportedly around 10:30", "sometime before noon", "early that evening", "in the morning", "shortly after midnight".',
    '',
    SOURCE_ATTRIBUTION_RULES,
    '',
    useAfRTopicMode ? AFR_RECURRING_STORY_RULES : '',
    '',
    satireBriefSection,
    '',
    includeBerlinThemes ? AVOID_OVERUSED_THEMES : '',
    '',
    includeBerlinThemes ? SURREALISM_AND_LOCAL_KNOWLEDGE : '',
    '',
    NEWSPAPER_STRUCTURE_RULES,
    '',
    NEWSPAPER_VARIANT_GUIDE,
    '',
    ANTI_META_SURREAL_RULES,
    '',
    useFeatureStoryPrompt
      ? [
          'Tone: Deadpan, serious journalism about absurd situations rooted in REAL social truths. Write with the straight-faced seriousness of a real news reporter, but the humor comes from brutal honesty about how people actually behave—the hypocrisy, the self-deception, the contradictions nobody wants to acknowledge. Think Louis CK doing journalism: the comedy is in naming what everyone sees but nobody says.',
          'Style: Write like a real local newspaper journalist—specific, detailed, factual-sounding. Include concrete details: names, addresses, times, quotes. But underneath the journalistic veneer, every paragraph should contain an observation so uncomfortably true that readers feel personally called out. The reporter is not just covering absurdity—they are exposing the real human behavior behind it.',
          'CRITICAL: This must be CONCRETE and SPECIFIC. No abstract concepts. Real names (fictional), real addresses, real times, real quotes. The absurdity is in the situation, not in abstract satire. But the REAL comedy is in the social criticism: why do people do this? What does it reveal about them? What hypocrisy does it expose?',
          '',
          EDGE_AND_POLITICAL_INCORRECTNESS,
          '',
          SPICE_IT_UP,
          '',
          INTELLECTUAL_EASTER_EGGS,
        ].join('\n')
      : [
          'Tone: irreverent, subversive, and unapologetically politically incorrect. Channel Oscar Wilde, Louis CK, Ricky Gervais, George Carlin, Bill Hicks, and classic British satire like Brass Eye. The comedy must come from REAL uncomfortable truths about society—hypocrisy, self-deception, moral posturing, the gap between what people say and what they do. Mock sacred cows, poke fun at every demographic equally, but always ground it in genuine social observation. The reader should think "holy shit, that IS what people do" not just "haha random". Nothing is off-limits except actual hate speech or calls to violence.',
          'Style: write like a stand-up comedian who became a journalist—someone who sees through every lie, every performance, every bit of social theater. Biting observations about real human behavior, cynical but earned cynicism, jokes that land because they are TRUE. The best line in every article should be the one where the reader feels personally attacked. Think: Ricky Gervais hosting the Golden Globes, but about Berlin.',
          '',
          EDGE_AND_POLITICAL_INCORRECTNESS,
          '',
          SPICE_IT_UP,
          '',
          INTELLECTUAL_EASTER_EGGS,
        ].join('\n'),
    topicInstruction,
    canonicalStructureInstruction,
    recentCanonicalReferencesSection,
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
    'ARTICLE LENGTH: The bodyMarkdown should be approximately 400 words. Do NOT exceed 500 words. Keep articles tight, punchy, and concise. Quality over quantity.',
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
        includeBerlinThemes
          ? '- Include concrete details: "On Tuesday, sometime before noon, residents of Müllerstraße 23 noticed..."'
          : '- Include concrete details: "On Tuesday, sometime before noon, residents noticed..."',
        includeBerlinThemes
          ? '- Name specific Berlin locations, streets, neighborhoods'
          : '- Name specific real-world locations relevant to the story',
        '- Include dialogue, witness accounts, official statements (all fictional but realistic)',
        '- The article should be approximately 400 words of detailed, specific reporting',
        '- MUST provide an imagePrompt: describe a photorealistic photo that would illustrate this news story',
        '',
        EDGE_SHORT,
        '',
        includeBerlinThemes ? WEDDING_REMINDER_SHORT : '',
        includeBerlinThemes ? '' : '',
        includeBerlinThemes ? TURKISH_REMINDER_SHORT : '',
        includeBerlinThemes ? '' : '',
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
          useAfRRssMode
            ? [
                '═══════════════════════════════════════════════════════════════════',
                'MANDATORY AfR MODE:',
                '- This RSS topic references AfD.',
                '- You MUST write about "Alternativ für Ratten (AfR)" instead.',
                '- The leader is Alice Rattenweidel.',
                '- Keep the piece focused on AfR developments in Berlin.',
                '- Satirize anti-immigrant rhetoric, racist dog whistles, pro-Russia spin, anti-EU panic, and related far-right tropes.',
                '- Mock and criticize these positions; do not endorse them.',
                '═══════════════════════════════════════════════════════════════════',
                '',
              ].join('\n')
            : '',
          // When drugs/techno is selected, add the required angle
          useDrugsOrTechnoTopic
            ? [
                '═══════════════════════════════════════════════════════════════════',
                'REQUIRED ANGLE - DRUGS/TECHNO/NIGHTLIFE:',
                randomFocus,
                '',
                includeBerlinThemes
                  ? 'You MUST connect this news topic to Berlin drugs/techno/nightlife culture.'
                  : 'You MUST connect this news topic to drugs/techno/nightlife culture.',
                'Find a way to tie the news story to clubs, drugs, DJs, Berghain, Sisyphos, after-parties, dealers, ketamine, etc.',
                includeBerlinThemes
                  ? 'The drugs/techno angle is MANDATORY - do not write a generic Berlin article.'
                  : 'The drugs/techno angle is MANDATORY - do not write a generic article.',
                '═══════════════════════════════════════════════════════════════════',
                '',
              ].join('\n')
            : '',
          includeBerlinThemes
            ? 'CRITICAL INSTRUCTION: You MUST write a satirical article that connects this real-world news topic to Berlin.'
            : 'CRITICAL INSTRUCTION: You MUST write a satirical article about this real-world news topic directly, without localizing it to Berlin.',
          includeBerlinThemes
            ? 'Take the essence/theme of this news story and write about how it manifests in Berlin, the Wedding neighborhood, or the Berlin expat/local scene.'
            : 'Take the essence/theme of this news story and satirize the broader political/media contradiction directly.',
          includeBerlinThemes
            ? 'REMINDER: "Wedding" refers to the Berlin neighborhood, NOT wedding ceremonies. Do NOT write about weddings, marriage, or wedding-related topics.'
            : '',
          SOURCE_ATTRIBUTION_RULES,
          'Examples of how to connect:',
          useDrugsOrTechnoTopic
            ? '- Connect to clubs, DJs, drug culture, after-parties, Berghain queues, dealer economics, ketamine therapy, etc.'
            : includeBerlinThemes
              ? '- If the news is about a tech company layoff, write about how Berlin startups are affected or how laid-off tech bros are now DJing'
              : '- If the news is about a tech company layoff, focus on media, workplace, and power contradictions in the story itself',
          includeBerlinThemes
            ? '- If the news is about politics, write about how Berliners react to it at their local Späti or how it affects the bureaucracy'
            : '- If the news is about politics, satirize the political/media behavior directly',
          includeBerlinThemes
            ? '- If the news is about climate, write about Berlin climate activists or how Berliners are coping'
            : '- If the news is about climate, satirize the policy, PR, and behavior gap directly',
          includeBerlinThemes
            ? '- If the news is about economy/inflation, write about Berlin rent, döner prices, or club entry fees'
            : '- If the news is about economy/inflation, satirize incentives, messaging, and consequences directly',
          '',
          'The connection to the real news should be CLEAR in the article, not just vaguely inspired.',
          includeBerlinThemes
            ? 'Your satirical angle should make fun of both the news topic AND Berlin culture simultaneously.'
            : 'Your satirical angle should expose the contradiction within the news topic itself.',
          strictTopicFocus
            ? [
                '',
                'STRICT TOPIC FOCUS (MANDATORY):',
                '- The headline must explicitly mention the key named entity from the topic when available (person, company, party, institution).',
                '- The opening paragraph must immediately signal this exact story.',
              ].join('\n')
            : '',
          '',
          'MAKE THE REAL-NEWS TOPIC OBVIOUS TO READERS:',
          '- Readers must understand which real-world news story you are satirizing WITHOUT reading the summary or metadata.',
          '- In the OPENING (first paragraph, subheadline, or headline) explicitly reference or clearly echo the news topic so a reader can say "this is about X".',
          '- Example: if the news is "Company X announces layoffs", your lead or subhead should make that clear (e.g. "In response to recent layoffs at...", "As tech firms slash jobs..."). Do not hide the connection.',
          '',
          'ARTICLE LENGTH: The article should be approximately 400 words. Do NOT exceed 500 words. Keep it tight, punchy, and concise.',
          '',
          outputSchemaMode === 'body-only-locked-draft'
            ? 'IMPORTANT: sourceRssTopic is server-locked in LOCKED DRAFT mode. Do not output this field.'
            : 'IMPORTANT: Since you are using this news topic, you MUST set "sourceRssTopic" in your JSON output to the EXACT news headline above.',
          outputSchemaMode === 'body-only-locked-draft'
            ? ''
            : `Copy this verbatim: "${selectedRssTopic}"`,
          '',
        ].join('\n')
      : [
          'TOPIC DIRECTION FOR THIS ARTICLE:',
          randomFocus,
          '',
          'You MUST write an article about this specific topic. Do not ignore it.',
          'This is your PRIMARY directive - the article must be clearly about this topic.',
          useAfRTopicMode ? AFR_RECURRING_STORY_RULES : '',
          '',
          'ARTICLE LENGTH: The article should be approximately 400 words. Do NOT exceed 500 words. Keep it tight, punchy, and concise.',
          input.forceOpinion
            ? [
                '',
                'MANDATORY: This article MUST be an opinion/editorial piece. You MUST set categorySlug to "opinion" and layout to "opinion".',
              ].join('\n')
            : '',
        ].join('\n')

  const seedDraftSection = input.seedDraft
    ? [
        'LOCKED DRAFT (MANDATORY):',
        `- Use this EXACT headline: "${input.seedDraft.headline.trim().slice(0, 140)}"`,
        typeof input.seedDraft.subheadline === 'string'
          ? `- Use this EXACT subheadline: "${input.seedDraft.subheadline.trim().slice(0, 220)}"`
          : '- Subheadline may be null if needed.',
        typeof input.seedDraft.excerpt === 'string'
          ? `- Use this EXACT excerpt: "${trimToReadableLength(input.seedDraft.excerpt, 300)}"`
          : '- Excerpt may be null if needed.',
        typeof input.seedDraft.topicHint === 'string' && input.seedDraft.topicHint.trim().length > 0
          ? `- Keep this SAME topic/news hook continuity: "${input.seedDraft.topicHint.trim().slice(0, 300)}"`
          : '',
        '- Build a full body that matches this pitch and keeps the same core premise.',
        '- In LOCKED DRAFT mode, headline/subheadline/excerpt are server-owned and must not be rewritten.',
      ].join('\n')
    : ''
  const editorDirectionSection =
    typeof input.editorDirection === 'string' && input.editorDirection.trim().length > 0
      ? [
          'EDITOR REVISION REQUEST (APPLY WHILE PRESERVING COHERENCE):',
          `- ${input.editorDirection.trim().slice(0, 1200)}`,
        ].join('\n')
      : ''

  const userPrompt = [
    topicsSection,
    'PRIMARY CHECK (MANDATORY): Build this article around one under-noticed detail that flips the official narrative.',
    'If your draft cannot name that contradiction clearly, rewrite before final output.',
    'Do NOT use the exact phrase "overlooked detail" in the article, excerpt, or subheadline.',
    '',
    canonicalStructureInstruction,
    recentCanonicalReferencesSection,
    seedDraftSection,
    editorDirectionSection,
    outputSchemaMode === 'body-only-locked-draft'
      ? [
          'LOCKED DRAFT RESPONSE MODE:',
          '- Do NOT return headline, subheadline, excerpt, or sourceRssTopic in JSON.',
          '- Return only body/content + metadata fields from the schema below.',
        ].join('\n')
      : '',
    'Important: ALL text fields must be written in US English.',
    SOURCE_ATTRIBUTION_RULES,
    '',
    `Tone profile target: ${toneProfile.toUpperCase()} (${TONE_PROFILE_GUIDANCE[toneProfile]})`,
    '',
    satireBriefSection,
    '',
    HUMOR_PERSPECTIVE_METHOD,
    '',
    useFeatureStoryPrompt
      ? [
          'CRITICAL FOR FEATURE/NEWS STORIES:',
          '- Your article MUST be concrete and specific. Include:',
          '  * Specific names of people (fictional but realistic: "Klaus Müller", "Sarah Schmidt", etc.)',
          '  * Specific addresses and locations ("Müllerstraße 23", "corner of Seestraße and Leopoldplatz")',
          '  * Approximate times and dates ("around 9:40 am", "reportedly around noon", "early that evening", "last Thursday")',
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
    'ARTICLE LENGTH: Keep the bodyMarkdown to approximately 400 words. Do NOT exceed 500 words. Tight, punchy writing is better than lengthy rambling.',
    '',
    'Return an article that could plausibly run on the front page of a satirical local paper.',
    '',
    includeBerlinThemes ? WEDDING_REMINDER_SHORT : '',
    '',
    includeBerlinThemes ? TURKISH_REMINDER_SHORT : '',
    '',
    strictTopicFocus
      ? [
          'STRICT TOPIC FOCUS (MANDATORY):',
          '- Keep the specific story subject front-and-center in headline and lead.',
          '- Do not drift into unrelated local color or backup themes.',
          '',
        ].join('\n')
      : '',
    NEWSPAPER_STRUCTURE_RULES,
    '',
    NEWSPAPER_VARIANT_GUIDE,
    '',
    ANTI_META_SURREAL_RULES,
    '',
    !useFeatureStoryPrompt
      ? [EDGE_SHORT, '', SPICE_IT_UP, '', INTELLECTUAL_EASTER_EGGS, ''].join('\n')
      : '',
    outputSchemaMode === 'body-only-locked-draft'
      ? 'HEADLINE/SUBHEADLINE/EXCERPT are locked by server. Focus only on body quality and metadata.'
      : [
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
                includeBerlinThemes
                  ? 'Your headline structure must be creative and varied. Avoid repetitive patterns like "Berlin [verb] [noun]".'
                  : 'Your headline structure must be creative and varied. Avoid repetitive formula patterns.',
                'Use different structures: questions, character-focused, descriptive, comparisons, direct statements, narratives, etc.',
                'Think like a real newspaper: headlines should grab attention with wit, not formula.',
                'Match your headline to your assigned topic—do not force unrelated themes into it.',
              ].join('\n'),
          '',
          INTELLECTUAL_HEADLINE_REFERENCES,
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
    outputSchemaMode === 'body-only-locked-draft' ? JSON_SCHEMA_BODY_ONLY : JSON_SCHEMA,
    '',
    IMAGE_PROMPT_INSTRUCTIONS,
  ].join('\n')

  LOG.trimmed('System prompt', systemPrompt, 600)
  LOG.trimmed('User prompt', userPrompt, 600)
  LOG.step('STEP 4: main LLM invoke (article generation)')
  const raw = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])
  LOG.step('STEP 5: main LLM done, parsing and validating')

  const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
  LOG.trimmed('LLM output', text, 800)

  try {
    const jsonText = extractFirstJsonObject(text)
    const parsed = JSON.parse(jsonText) as unknown
    const hydratedForValidation =
      outputSchemaMode === 'body-only-locked-draft'
        ? hydrateLockedDraftFields({
            output: parsed,
            seedDraft: input.seedDraft,
            usedRssTopic: actuallyUsedRssTopic,
          })
        : parsed
    const validation = GeneratedArticleSchema.safeParse(hydratedForValidation)
    let validated: GeneratedArticle
    if (!validation.success) {
      console.log(`${LOG.prefix} Schema validation failed, repairing...`)
      validated = await repairToSchema({
        badOutput: text,
        categories: input.categories,
        authors: input.authors,
        validationErrors: validation.error.issues,
        outputSchemaMode,
        seedDraft: input.seedDraft,
        usedRssTopic: actuallyUsedRssTopic,
      })
    } else {
      validated = validation.data
    }

    if (input.forceOpinion) {
      validated = { ...validated, categorySlug: 'opinion', layout: 'opinion' }
    }
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
    if (
      !input.seedDraft?.headline &&
      headlineViolatesBannedWords(validated.headline, bannedOpeningWords)
    ) {
      validated = await regenerateHeadline({
        article: validated,
        bannedOpeningWords,
        recentTitles: input.recentArticleTitles,
      })
    }

    try {
      if (critiqueEnabled) {
        const critique = await critiqueSatireArticle({
          apiKey,
          modelName,
          toneProfile,
          article: validated,
          brief: satireBrief,
          includeBerlinThemes,
        })

        if (critique) {
          console.log(
            `${LOG.prefix} Critique scores | dark=${critique.darknessScore} political=${critique.politicalCriticismScore} discomfort=${critique.discomfortScore} specificity=${critique.specificityScore}`,
          )
          if (shouldRewriteFromCritique(critique, minCritiqueScore)) {
            console.log(
              `${LOG.prefix} Critique below threshold; rewriting article for stronger bite`,
            )
            validated = await rewriteArticleFromCritique({
              apiKey,
              modelName,
              article: validated,
              critique,
              brief: satireBrief,
              toneProfile,
              categories: input.categories,
              authors: input.authors,
              includeBerlinThemes,
            })

            const rewrittenLangSample =
              `${validated.headline}\n${validated.subheadline ?? ''}\n${validated.bodyMarkdown}`.slice(
                0,
                1200,
              )
            if (looksNonEnglish(rewrittenLangSample)) {
              validated = await translateToEnglish({
                bad: validated,
                categories: input.categories,
                authors: input.authors,
              })
            }

            if (
              !input.seedDraft?.headline &&
              headlineViolatesBannedWords(validated.headline, bannedOpeningWords)
            ) {
              validated = await regenerateHeadline({
                article: validated,
                bannedOpeningWords,
                recentTitles: input.recentArticleTitles,
              })
            }
          }
        } else {
          console.log(`${LOG.prefix} Critique unavailable; keeping first-pass article`)
        }
      } else {
        console.log(`${LOG.prefix} Critique disabled by SATIRE_CRITIQUE_ENABLED`)
      }
    } catch (err) {
      console.warn(`${LOG.prefix} Critique/rewrite step failed; keeping current article`, err)
    }

    validated = ensureAfRExplanationInNonHeadlineText(
      sanitizeMetaSurrealFraming(
        sanitizeCanonicalAttributionMentions(sanitizeArticleSourceMentions(validated)),
      ),
      { force: useAfRTopicMode },
    )

    if (input.forceOpinion) {
      validated = { ...validated, categorySlug: 'opinion', layout: 'opinion' }
    }

    validated = enforceSourceRssTopic(validated, actuallyUsedRssTopic)
    validated = finalizeGeneratedExcerpt(applySeedDraft(validated, input.seedDraft))

    if (includeBerlinThemes) {
      // CRITICAL: Check for wedding ceremony content - "Wedding" is a neighborhood, not wedding ceremonies
      assertNotAboutWeddingCeremonies(validated)
    }

    assertArticleNotTooSimilarToRecentCoverage({
      article: validated,
      recentTitles,
      recentExcerpts,
      latestArticleContentSample: input.latestArticleContentSample,
    })

    LOG.step('STEP 6: generateArticle finished (valid output)')
    return {
      article: validated,
      usedRssTopic: actuallyUsedRssTopic, // Track server-side which RSS topic was actually used in the prompt
      usedDrugsTechno: useDrugsOrTechnoTopic || useDrugsOrTechnoScenario,
      usedStartup: useStartupTopic || useStartupScenario,
    }
  } catch (err) {
    if (isRetryableGenerationError(err)) {
      throw err
    }
    console.log(`${LOG.prefix} Parse/validation error, repairing...`)
    // Fallback: deterministic repair using cheaper model
    const repaired = ensureAfRExplanationInNonHeadlineText(
      sanitizeMetaSurrealFraming(
        sanitizeCanonicalAttributionMentions(
          sanitizeArticleSourceMentions(
            await repairToSchema({
              badOutput: text,
              categories: input.categories,
              authors: input.authors,
              outputSchemaMode,
              seedDraft: input.seedDraft,
              usedRssTopic: actuallyUsedRssTopic,
            }),
          ),
        ),
      ),
      { force: useAfRTopicMode },
    )
    if (input.forceOpinion) {
      repaired.categorySlug = 'opinion'
      repaired.layout = 'opinion'
    }

    const repairedWithSeed = finalizeGeneratedExcerpt(
      applySeedDraft(enforceSourceRssTopic(repaired, actuallyUsedRssTopic), input.seedDraft),
    )

    if (includeBerlinThemes) {
      // CRITICAL: Check for wedding ceremony content - "Wedding" is a neighborhood, not wedding ceremonies
      assertNotAboutWeddingCeremonies(repairedWithSeed)
    }

    assertArticleNotTooSimilarToRecentCoverage({
      article: repairedWithSeed,
      recentTitles,
      recentExcerpts,
      latestArticleContentSample: input.latestArticleContentSample,
    })

    LOG.step('STEP 6: generateArticle finished (repaired after parse error)')
    return {
      article: repairedWithSeed,
      usedRssTopic: actuallyUsedRssTopic, // Track server-side which RSS topic was actually used in the prompt
      usedDrugsTechno: useDrugsOrTechnoTopic || useDrugsOrTechnoScenario,
      usedStartup: useStartupTopic || useStartupScenario,
    }
  }
}
