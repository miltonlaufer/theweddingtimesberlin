import type { RecentCoverageItem, SlotConfig } from './pipelineTypes'

export type EditorialTheme =
  | 'rss-current-news'
  | 'afr-politics'
  | 'drugs-nightlife'
  | 'bureaucracy-civic'
  | 'kiez-local'
  | 'gentrification-startup'
  | 'food-culture'
  | 'opinion'
  | 'general-local'

export type EditorialPlanSummary = {
  recentWindowSize: number
  themeCounts: Record<EditorialTheme, number>
  saturatedThemes: EditorialTheme[]
  plannedThemes: EditorialTheme[]
}

export type EditorialPlan = {
  slots: SlotConfig[]
  summary: EditorialPlanSummary
}

type PlanEditorialSlotsArgs = {
  count: number
  hasRssTopics: boolean
  forceOpinionFirst: boolean
  recentCoverage: RecentCoverageItem[]
  includeHumorPerspectiveMethod?: () => boolean
  forcedRssSlots?: number
  previousBatchMetadata?: unknown
}

const DEFAULT_FORCED_RSS_RATIO = 0.66
const RECENT_WINDOW_SIZE = 20
const DRUGS_NIGHTLIFE_SATURATION_COUNT = 4
const DRUGS_NIGHTLIFE_SATURATION_RATIO = 0.25
const NON_RSS_EXTREME_STYLE_DIRECTION =
  'Extreme non-RSS style: make the premise cruel, surreal, and structurally bizarre, not merely quirky. Start from one concrete Berlin truth, introduce one impossible institutional rule or physical fact, then escalate its consequences with deadpan journalistic logic. Aim cruelty upward at hypocrisy, vanity, power, cowardice, and fake compassion; never at protected traits or people suffering for reasons they cannot control. Do not explain the surrealism.'

const THEME_ORDER: EditorialTheme[] = [
  'bureaucracy-civic',
  'kiez-local',
  'food-culture',
  'gentrification-startup',
  'drugs-nightlife',
  'general-local',
]

const EMPTY_COUNTS: Record<EditorialTheme, number> = {
  'rss-current-news': 0,
  'afr-politics': 0,
  'drugs-nightlife': 0,
  'bureaucracy-civic': 0,
  'kiez-local': 0,
  'gentrification-startup': 0,
  'food-culture': 0,
  opinion: 0,
  'general-local': 0,
}

const DRUGS_NIGHTLIFE_PATTERN =
  /\b(drug|drugs|cocaine|ketamine|keta|ecstasy|mdma|dealer|dealers|pill|pills|speed|weed|hash|sober|overdose|harm reduction|club|clubs|bouncer|bouncers|door policy|techno|rave|dj|djs|bathroom|toilet)\b/i

const STARTUP_GENTRIFICATION_PATTERN =
  /\b(startup|founder|vc|venture|pitch|co-?working|expat|gentrification|rent|landlord|housing|apartment|wellness|disruption)\b/i

const BUREAUCRACY_CIVIC_PATTERN =
  /\b(buergeramt|bürgeramt|office|permit|form|paperwork|queue|council|district|senate|bvg|police|tax|school|kita|hospital|doctor|health|inspection|application|appointment|admin|administration)\b/i

const FOOD_CULTURE_PATTERN =
  /\b(spaeti|späti|kiosk|cafe|coffee|market|supermarket|restaurant|doener|döner|bakery|bar|beer|food|drink|museum|gallery|artist|culture|sauna)\b/i

function normalizeCategorySlug(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function previousBatchScheduledAfR(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  return (metadata as Record<string, unknown>).afrScheduledThisRun === true
}

export function classifyRecentCoverage(item: RecentCoverageItem): EditorialTheme[] {
  const text = `${item.headline} ${item.excerpt}`.toLowerCase()
  const categorySlug = normalizeCategorySlug(item.categorySlug)
  const themes = new Set<EditorialTheme>()

  if (typeof item.sourceRssTopic === 'string' && item.sourceRssTopic.trim().length > 0) {
    themes.add('rss-current-news')
  }
  if (categorySlug === 'opinion') themes.add('opinion')
  if (
    ['nightlife', 'drugs', 'techno'].includes(categorySlug) ||
    DRUGS_NIGHTLIFE_PATTERN.test(text)
  ) {
    themes.add('drugs-nightlife')
  }
  if (
    categorySlug === 'gentrification' ||
    categorySlug === 'startup' ||
    STARTUP_GENTRIFICATION_PATTERN.test(text)
  ) {
    themes.add('gentrification-startup')
  }
  if (
    ['bureaucracy', 'politics', 'crime'].includes(categorySlug) ||
    BUREAUCRACY_CIVIC_PATTERN.test(text)
  ) {
    themes.add('bureaucracy-civic')
  }
  if (categorySlug === 'food-drink' || categorySlug === 'art' || FOOD_CULTURE_PATTERN.test(text)) {
    themes.add('food-culture')
  }
  if (['kiez', 'leopoldplatz', 'filth', 'decadence'].includes(categorySlug)) {
    themes.add('kiez-local')
  }

  if (themes.size === 0) themes.add('general-local')
  return Array.from(themes)
}

function countThemes(recentCoverage: RecentCoverageItem[]): Record<EditorialTheme, number> {
  const counts = { ...EMPTY_COUNTS }
  for (const item of recentCoverage.slice(0, RECENT_WINDOW_SIZE)) {
    for (const theme of classifyRecentCoverage(item)) {
      counts[theme] += 1
    }
  }
  return counts
}

function isDrugsNightlifeSaturated(
  counts: Record<EditorialTheme, number>,
  recentWindowSize: number,
): boolean {
  if (recentWindowSize === 0) return false
  const count = counts['drugs-nightlife']
  return (
    count >= DRUGS_NIGHTLIFE_SATURATION_COUNT ||
    count / recentWindowSize >= DRUGS_NIGHTLIFE_SATURATION_RATIO
  )
}

function editorialDirection(theme: EditorialTheme): string {
  switch (theme) {
    case 'rss-current-news':
      return 'Use the assigned current-news topic directly. Keep it current-news first; do not pivot to drugs/nightlife unless the news item itself is explicitly about that.'
    case 'afr-politics':
      return `Write exactly one new political story about the fictional far-right rat party Alternativ für Ratten (AfR), led by Alice Rattenweidel. Mock and criticize its hypocrisy, racism, authoritarianism, pro-Russia opportunism, and culture-war theater; never endorse those positions. ${NON_RSS_EXTREME_STYLE_DIRECTION}`
    case 'bureaucracy-civic':
      return `Choose a bureaucracy or civic-life premise: offices, permits, queues, BVG, schools, health systems, inspections, paperwork, or district politics. Avoid clubs and drugs. ${NON_RSS_EXTREME_STYLE_DIRECTION}`
    case 'kiez-local':
      return `Choose a concrete Kiez/local-life premise: street behavior, neighbors, public space, shops, weather, trash, courtyards, noise, or everyday Wedding friction. Avoid clubs and drugs. ${NON_RSS_EXTREME_STYLE_DIRECTION}`
    case 'food-culture':
      return `Choose a food, drink, arts, culture, market, kiosk, cafe, museum, or local commerce premise. Avoid clubs and drugs. ${NON_RSS_EXTREME_STYLE_DIRECTION}`
    case 'gentrification-startup':
      return `Choose a startup, expat, co-working, wellness-capitalism, VC, or gentrification premise. Do not default to generic rent pain unless the angle is unusually specific. ${NON_RSS_EXTREME_STYLE_DIRECTION}`
    case 'drugs-nightlife':
      return `Use drugs/nightlife only for this slot. Make it specific and avoid repeating recent dealer, bouncer, door-policy, ketamine, or club-bathroom premises. ${NON_RSS_EXTREME_STYLE_DIRECTION}`
    case 'opinion':
      return `Write an opinion/editorial premise with a clear point of view and a concrete local target. ${NON_RSS_EXTREME_STYLE_DIRECTION}`
    case 'general-local':
      return `Choose a fresh local Berlin/Wedding premise outside saturated recent themes. Prefer concrete institutions, rituals, places, and consequences. ${NON_RSS_EXTREME_STYLE_DIRECTION}`
  }
}

function slotForTheme(
  theme: EditorialTheme,
  includeHumorPerspectiveMethod: () => boolean,
): SlotConfig {
  return {
    forceDrugsTechno: theme === 'drugs-nightlife' ? true : false,
    forceStartup: theme === 'gentrification-startup' ? true : false,
    forceRss: theme === 'rss-current-news',
    forceAfR: theme === 'afr-politics',
    forceOpinion: theme === 'opinion',
    includeTopics: theme === 'rss-current-news',
    useHumorPerspectiveMethod: includeHumorPerspectiveMethod(),
    themeBucket: theme,
    editorDirection: editorialDirection(theme),
  }
}

function rankFillThemes(
  counts: Record<EditorialTheme, number>,
  saturatedThemes: Set<EditorialTheme>,
): EditorialTheme[] {
  return THEME_ORDER.filter((theme) => !saturatedThemes.has(theme)).sort((a, b) => {
    const countDiff = counts[a] - counts[b]
    if (countDiff !== 0) return countDiff
    return THEME_ORDER.indexOf(a) - THEME_ORDER.indexOf(b)
  })
}

export function planEditorialSlots(args: PlanEditorialSlotsArgs): EditorialPlan {
  const count = Math.max(0, Math.floor(args.count))
  const includeHumorPerspectiveMethod = args.includeHumorPerspectiveMethod ?? (() => false)
  const recentWindowSize = Math.min(args.recentCoverage.length, RECENT_WINDOW_SIZE)
  const themeCounts = countThemes(args.recentCoverage)
  const saturatedThemes = new Set<EditorialTheme>()

  if (isDrugsNightlifeSaturated(themeCounts, recentWindowSize)) {
    saturatedThemes.add('drugs-nightlife')
  }

  const rssSlots = args.hasRssTopics
    ? Math.min(args.forcedRssSlots ?? Math.ceil(count * DEFAULT_FORCED_RSS_RATIO), count)
    : 0
  const nonRssCapacity = count - rssSlots
  const forceAfRThisRun =
    !previousBatchScheduledAfR(args.previousBatchMetadata) && nonRssCapacity > 0

  const plannedThemes: EditorialTheme[] = []
  if (args.forceOpinionFirst && nonRssCapacity > 0 && (!forceAfRThisRun || nonRssCapacity > 1)) {
    plannedThemes.push('opinion')
  }
  if (forceAfRThisRun) plannedThemes.push('afr-politics')

  for (let i = 0; i < rssSlots; i++) {
    plannedThemes.push('rss-current-news')
  }

  const fillThemes = rankFillThemes(themeCounts, saturatedThemes)
  let fillIndex = 0
  while (plannedThemes.length < count) {
    const nextTheme = fillThemes[fillIndex % fillThemes.length] ?? 'general-local'
    plannedThemes.push(nextTheme)
    fillIndex += 1
  }

  const limitedThemes = plannedThemes.slice(0, count)
  const slots = limitedThemes.map((theme) => slotForTheme(theme, includeHumorPerspectiveMethod))

  return {
    slots,
    summary: {
      recentWindowSize,
      themeCounts,
      saturatedThemes: Array.from(saturatedThemes),
      plannedThemes: limitedThemes,
    },
  }
}
