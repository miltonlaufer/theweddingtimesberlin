export const HEADLINE_LANGUAGE_GUARD_PREFIX = 'HEADLINE_LANGUAGE_GUARD'

export const HEADLINE_LANGUAGE_POLICY_PROMPT = [
  'HEADLINE LANGUAGE POLICY (MANDATORY):',
  '- The headline must be English-led: at least 60% of classified language words must be English.',
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
    'logic',
    'meets',
    'midnight',
    'new',
    'night',
    'of',
    'on',
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

const NEUTRAL_EVIDENCE = new Set(['afd', 'berlin', 'bvg', 'hertha', 'leipzig', 'söder', 'wedding'])
const WORD_PATTERN = /\p{L}+/gu
const QUOTE_PATTERN = /“[^”]*”|„[^“]*“|‘[^’]*’|"[^"]*"|'[^']*'/gu
const GERMAN_SUFFIX_PATTERN =
  /(?:ung|ungen|keit|keiten|heit|heiten|schaft|schaften|chen|lein|isch|ischen|ieren|iert)$/u

function classifyWord(raw: string): Language {
  const normalized = raw.toLocaleLowerCase('de-DE')
  if (NEUTRAL_EVIDENCE.has(normalized) || (raw.length > 1 && raw === raw.toUpperCase())) {
    return 'neutral'
  }
  if (ENGLISH_EVIDENCE.has(normalized)) return 'english'
  if (GERMAN_EVIDENCE.has(normalized)) return 'german'
  if (/[äöüß]/u.test(normalized)) return 'german'
  if (normalized.length >= 6 && GERMAN_SUFFIX_PATTERN.test(normalized)) return 'german'
  return 'neutral'
}

function tokenize(headline: string): WordToken[] {
  return Array.from(headline.matchAll(WORD_PATTERN), (match) => {
    const start = match.index ?? 0
    return {
      raw: match[0],
      normalized: match[0].toLocaleLowerCase('de-DE'),
      start,
      end: start + match[0].length,
      language: classifyWord(match[0]),
    }
  })
}

function quoteRanges(headline: string): QuoteRange[] {
  return Array.from(headline.matchAll(QUOTE_PATTERN), (match) => {
    const start = match.index ?? 0
    return { start, end: start + match[0].length }
  })
}

function containingQuote(token: WordToken, ranges: QuoteRange[]): QuoteRange | undefined {
  return ranges.find((range) => token.start >= range.start && token.end <= range.end)
}

export function assessHeadlineLanguage(headline: string): HeadlineLanguageAssessment {
  const tokens = tokenize(headline)
  const ranges = quoteRanges(headline)
  const english = tokens.filter((token) => token.language === 'english')
  const german = tokens.filter((token) => token.language === 'german')
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
  if (hasAdjacentIsolatedGerman) signals.push('unquoted-german-clause')

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
  const germanWordCount = text
    ? tokenize(text).filter((token) => token.language === 'german').length
    : 0
  const signals = germanWordCount > 0 ? ['german-words-in-supporting-text'] : []
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
