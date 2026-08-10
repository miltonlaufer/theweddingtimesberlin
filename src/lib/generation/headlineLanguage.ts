export const HEADLINE_LANGUAGE_GUARD_PREFIX = 'HEADLINE_LANGUAGE_GUARD'

export const HEADLINE_LANGUAGE_POLICY_PROMPT = [
  'HEADLINE LANGUAGE POLICY (MANDATORY):',
  '- The headline must be English-led: at least 60% of classified language words must be English.',
  '- Proper names, place names, acronyms, numbers, and punctuation are excluded from the denominator.',
  '- You may use EITHER one quoted German phrase of at most four words OR at most two isolated German terms, never both.',
  '- Do not write a full German clause or sentence.',
  '- A German RSS headline is source material only. Translate and rewrite it into an original English-led headline.',
  '- Subheadline and excerpt must be entirely in US English.',
].join('\n')

export type HeadlineLanguageAssessment = {
  passes: boolean
  englishShare: number
  englishWordCount: number
  germanWordCount: number
  germanQuoteCount: number
  maxGermanQuoteWords: number
  isolatedGermanWordCount: number
  signals: string[]
  reason: string
}

export type SupportingTextLanguageAssessment = {
  passes: boolean
  germanWordCount: number
  signals: string[]
  reason: string
}

export type ArticleLanguageFields = {
  headline: string
  subheadline?: string | null
  excerpt?: string | null
}

type Language = 'english' | 'german' | 'neutral'
type WordToken = { raw: string; normalized: string; start: number; end: number; language: Language }
type QuoteRange = { start: number; end: number }

const ENGLISH_EVIDENCE = new Set(
  [
    'a',
    'after',
    'and',
    'ashtray',
    'at',
    'becomes',
    'by',
    'controls',
    'customer',
    'desk',
    'diplomacy',
    'economy',
    'english',
    'etiquette',
    'every',
    'for',
    'founder',
    'from',
    'hospital',
    'in',
    'is',
    'kitchen',
    'lab',
    'logic',
    'meets',
    'midnight',
    'new',
    'night',
    'of',
    'on',
    'opens',
    'rules',
    'service',
    'shift',
    'strategy',
    'the',
    'to',
    'with',
  ].map((word) => word.toLocaleLowerCase('en-US')),
)

const GERMAN_EVIDENCE = new Set(
  [
    'aber',
    'alle',
    'als',
    'am',
    'anmeldung',
    'arschloch',
    'auf',
    'aus',
    'bei',
    'bitte',
    'bürgeramt',
    'dann',
    'das',
    'dass',
    'dich',
    'döner',
    'die',
    'draußen',
    'du',
    'ein',
    'eine',
    'für',
    'fürchte',
    'hauseingang',
    'ich',
    'im',
    'ist',
    'jetzt',
    'kiez',
    'leihfahrräder',
    'leute',
    'liste',
    'meinen',
    'meisten',
    'mit',
    'nicht',
    'noch',
    'nur',
    'oder',
    'parke',
    'privatjet',
    'schäm',
    'sie',
    'späti',
    'und',
    'vater',
    'vom',
    'warten',
  ].map((word) => word.toLocaleLowerCase('de-DE')),
)

const NEUTRAL_EVIDENCE = new Set([
  'afd',
  'berlin',
  'bvg',
  'hertha',
  'köln',
  'leipzig',
  'müller',
  'münchen',
  'söder',
  'samsung',
  'wedding',
  'zürich',
])
const GERMAN_CLAUSE_DETERMINERS = new Set(['das', 'dem', 'den', 'der', 'des', 'die', 'ein', 'eine'])
const GERMAN_CLAUSE_PRONOUNS = new Set(['du', 'ich', 'ihr', 'sie', 'wir'])
const GERMAN_CLAUSE_VERBS = new Set([
  'bleibt',
  'bleiben',
  'braucht',
  'brauchen',
  'darf',
  'dürfen',
  'geht',
  'gehen',
  'hat',
  'haben',
  'ist',
  'kommt',
  'kommen',
  'liegt',
  'liegen',
  'macht',
  'machen',
  'muss',
  'müssen',
  'sagt',
  'sagen',
  'sieht',
  'siehst',
  'sehen',
  'sind',
  'steht',
  'stehen',
  'wartet',
  'warten',
  'wird',
  'werden',
])
const ENGLISH_DIE_PREVIOUS_CONTEXT = new Set([
  'a',
  'an',
  'can',
  'could',
  'i',
  'may',
  'might',
  'must',
  'patients',
  'people',
  'should',
  'the',
  'they',
  'to',
  'we',
  'will',
  'would',
  'you',
])
const ENGLISH_DIE_NEXT_CONTEXT = new Set([
  'after',
  'alone',
  'at',
  'before',
  'every',
  'for',
  'from',
  'hard',
  'has',
  'in',
  'is',
  'on',
  'was',
  'young',
])
const WORD_PATTERN = /\p{L}+/gu
const QUOTE_PATTERNS = [
  /“[^”]*”/gu,
  /„[^“]*“/gu,
  /‘[^’]*’/gu,
  /»[^«]*«/gu,
  /«[^»]*»/gu,
  /"[^"\n]*"/gu,
  /(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu,
]
const GERMAN_SUFFIX_PATTERN =
  /(?:ung|ungen|keit|keiten|heit|heiten|schaft|schaften|chen|lein|isch|ischen|ieren|iert)$/u

function classifyWord(raw: string): Language {
  const normalized = raw.normalize('NFC').toLocaleLowerCase('de-DE')
  if (ENGLISH_EVIDENCE.has(normalized)) return 'english'
  if (GERMAN_EVIDENCE.has(normalized)) return 'german'
  if (NEUTRAL_EVIDENCE.has(normalized)) return 'neutral'
  if (/[äöüß]/u.test(normalized)) return 'german'
  if (normalized.length >= 6 && GERMAN_SUFFIX_PATTERN.test(normalized)) return 'german'
  if (/^[A-Z]{2,5}$/u.test(raw)) return 'neutral'
  if (/^\p{Lu}[\p{Ll}\p{M}]+$/u.test(raw)) return 'neutral'
  return 'neutral'
}

function tokenize(headline: string): WordToken[] {
  const normalizedHeadline = headline.normalize('NFC')
  const rawTokens = Array.from(normalizedHeadline.matchAll(WORD_PATTERN), (match) => {
    const start = match.index ?? 0
    return {
      raw: match[0],
      normalized: match[0].toLocaleLowerCase('de-DE'),
      start,
      end: start + match[0].length,
    }
  })

  return rawTokens.map((token) => ({
    ...token,
    language: classifyWord(token.raw),
  }))
}

function quoteRanges(headline: string): QuoteRange[] {
  const normalizedHeadline = headline.normalize('NFC')
  return QUOTE_PATTERNS.flatMap((pattern) =>
    Array.from(normalizedHeadline.matchAll(pattern), (match) => {
      const start = match.index ?? 0
      return { start, end: start + match[0].length }
    }),
  ).sort((left, right) => left.start - right.start)
}

function containingQuote(token: WordToken, ranges: QuoteRange[]): QuoteRange | undefined {
  return ranges.find((range) => token.start >= range.start && token.end <= range.end)
}

function isAffirmativeGermanClauseVerb(token: WordToken, followsPronoun: boolean): boolean {
  if (GERMAN_CLAUSE_VERBS.has(token.normalized)) return true

  return (
    followsPronoun &&
    token.raw === token.raw.toLocaleLowerCase('de-DE') &&
    token.normalized.length >= 4 &&
    token.normalized.endsWith('st')
  )
}

function hasStructuredUnquotedGermanClause(
  tokens: WordToken[],
  germanQuoteRanges: QuoteRange[],
): boolean {
  return tokens.some((startToken, startIndex) => {
    if (
      startToken.language !== 'german' ||
      containingQuote(startToken, germanQuoteRanges) ||
      (!GERMAN_CLAUSE_DETERMINERS.has(startToken.normalized) &&
        !GERMAN_CLAUSE_PRONOUNS.has(startToken.normalized))
    ) {
      return false
    }

    const clauseTokens: WordToken[] = []
    for (let index = startIndex; index < tokens.length; index += 1) {
      const token = tokens[index]!
      if (containingQuote(token, germanQuoteRanges)) break
      if (index > startIndex && token.language === 'english') break
      clauseTokens.push(token)
    }

    const startsWithDeterminer = GERMAN_CLAUSE_DETERMINERS.has(startToken.normalized)
    if (startsWithDeterminer) {
      return clauseTokens.slice(2).some((token) => isAffirmativeGermanClauseVerb(token, false))
    }

    return clauseTokens.slice(1).some((token) => isAffirmativeGermanClauseVerb(token, true))
  })
}

function isContextualEnglishDie(tokens: WordToken[], index: number): boolean {
  const token = tokens[index]
  if (token?.normalized !== 'die') return false

  return (
    ENGLISH_DIE_PREVIOUS_CONTEXT.has(tokens[index - 1]?.normalized ?? '') ||
    ENGLISH_DIE_NEXT_CONTEXT.has(tokens[index + 1]?.normalized ?? '')
  )
}

export function assessHeadlineLanguage(headline: string): HeadlineLanguageAssessment {
  const normalizedHeadline = headline.normalize('NFC')
  const tokens = tokenize(normalizedHeadline)
  const ranges = quoteRanges(normalizedHeadline)
  const contextualEnglishDieIndexes = new Set(
    tokens.flatMap((_, index) => (isContextualEnglishDie(tokens, index) ? [index] : [])),
  )
  const english = tokens.filter(
    (token, index) => token.language === 'english' || contextualEnglishDieIndexes.has(index),
  )
  const german = tokens.filter(
    (token, index) => token.language === 'german' && !contextualEnglishDieIndexes.has(index),
  )
  const germanQuoteRanges = ranges.filter((range) =>
    german.some((token) => token.start >= range.start && token.end <= range.end),
  )
  const maxGermanQuoteWords = Math.max(
    0,
    ...germanQuoteRanges.map(
      (range) =>
        tokens.filter((token) => token.start >= range.start && token.end <= range.end).length,
    ),
  )
  const isolatedGerman = german.filter((token) => !containingQuote(token, germanQuoteRanges))
  const isolatedIndexes = isolatedGerman.map((token) => tokens.indexOf(token))
  const hasAdjacentIsolatedGerman = isolatedIndexes.some(
    (index, position) => position > 0 && index === isolatedIndexes[position - 1]! + 1,
  )
  const hasStructuredGermanClause = hasStructuredUnquotedGermanClause(tokens, germanQuoteRanges)
  const classifiedCount = english.length + german.length
  const englishShare =
    german.length === 0 ? 1 : classifiedCount === 0 ? 0 : english.length / classifiedCount
  const signals: string[] = []

  if (englishShare < 0.6) signals.push('english-share-below-60')
  if (germanQuoteRanges.length > 1) signals.push('multiple-german-quotes')
  if (maxGermanQuoteWords > 4) signals.push('german-quote-too-long')
  if (isolatedGerman.length > 2) signals.push('too-many-isolated-german-terms')
  if (germanQuoteRanges.length > 0 && isolatedGerman.length > 0) {
    signals.push('mixed-german-allowances')
  }
  if (hasAdjacentIsolatedGerman || hasStructuredGermanClause) {
    signals.push('unquoted-german-clause')
  }

  const passes = signals.length === 0
  return {
    passes,
    englishShare,
    englishWordCount: english.length,
    germanWordCount: german.length,
    germanQuoteCount: germanQuoteRanges.length,
    maxGermanQuoteWords,
    isolatedGermanWordCount: isolatedGerman.length,
    signals,
    reason: passes ? 'headline-language: accepted' : `headline-language: ${signals.join(', ')}`,
  }
}

export function assessSupportingTextLanguage(
  text: string | null,
): SupportingTextLanguageAssessment {
  const tokens = text ? tokenize(text) : []
  const germanWordCount = tokens.filter((token, index) => {
    if (token.language !== 'german') return false
    if (isContextualEnglishDie(tokens, index)) return false
    return true
  }).length
  const signals: string[] = []
  if (germanWordCount > 0) signals.push('german-words-in-supporting-text')
  const passes = signals.length === 0

  return {
    passes,
    germanWordCount,
    signals,
    reason: passes ? 'headline-language: accepted' : `headline-language: ${signals.join(', ')}`,
  }
}

export function assertHeadlineLanguagePolicy(headline: string): void {
  const assessment = assessHeadlineLanguage(headline)
  if (!assessment.passes) {
    throw new Error(`${HEADLINE_LANGUAGE_GUARD_PREFIX}: ${assessment.reason}`)
  }
}

export function assertArticleLanguagePolicy(article: ArticleLanguageFields): void {
  const headline = assessHeadlineLanguage(article.headline)
  if (!headline.passes) {
    throw new Error(`${HEADLINE_LANGUAGE_GUARD_PREFIX}: headline ${headline.reason}`)
  }

  for (const field of ['subheadline', 'excerpt'] as const) {
    const supportingText = assessSupportingTextLanguage(article[field] ?? null)
    if (!supportingText.passes) {
      throw new Error(`${HEADLINE_LANGUAGE_GUARD_PREFIX}: ${field} ${supportingText.reason}`)
    }
  }
}
