import { trimToReadableLength } from './trimToReadableLength'

const TERMINAL_ENDING_RE = /[.!?]["')\]]?$/
const TRAILING_CONNECTORS = new Set([
  'and',
  'or',
  'but',
  'the',
  'a',
  'an',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'by',
  'from',
  'as',
  'if',
  'that',
  'who',
  'which',
  'while',
  'where',
  'when',
  'at',
  'into',
  'over',
  'under',
])

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

const META_SUMMARY_VOICE_PATTERNS: RegExp[] = [
  /\bthe\s+joke\s+is\s+not\b/i,
  /\b(?:the\s+)?(?:joke|punchline)\s+(?:is|here|works|comes\s+from|lands|hinges\s+on)\b/i,
  /\b(?:the\s+)?(?:satire|premise|bit|gag|angle|comic\s+engine)\s+(?:is|works|comes\s+from|lands|hinges\s+on)\b/i,
  /\b(?:this|the)\s+(?:piece|article|story|essay|dispatch|satire)\s+(?:follows|tracks|explores|examines|argues|shows|reveals|satirizes|uses|turns|asks|is\s+about)\b/i,
  /\b(?:explains?|unpacks?|summari[sz]es)\s+the\s+(?:joke|satire|premise|angle|creative\s+process)\b/i,
]

export function hasMetaSummaryVoice(value: string): boolean {
  const normalized = collapseWhitespace(value)
  if (!normalized) return false
  return META_SUMMARY_VOICE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function hasTerminalExcerptEnding(value: string): boolean {
  const normalized = collapseWhitespace(value)
  if (/(?:\.\.\.|…)$/.test(normalized)) return false
  return TERMINAL_ENDING_RE.test(normalized)
}

function trimToLastSentenceBoundary(value: string, minRatio = 0.55): string {
  const matches = [...value.matchAll(/[.!?]["')\]]?\s+/g)]
  const last = matches.at(-1)
  if (!last) return value
  const sentenceEnd = (last.index ?? 0) + last[0].trimEnd().length
  if (sentenceEnd < Math.floor(value.length * minRatio)) return value
  return value.slice(0, sentenceEnd).trim()
}

function stripDanglingTrailingClause(value: string): string {
  const match = value.match(
    /\s+(?:[–—-]|,|;)\s+(?:and|or|but|while|where|when|as|because|since|although|though|unless|until|before|after|with|without|who|which|that|whose|so|then)\b([^.!?]*)([.!?]["')\]]?)?$/i,
  )
  if (!match || typeof match.index !== 'number') return value

  const clause = (match[1] ?? '').trim()
  const terminal = match[2] ?? ''
  const lastWord = clause
    .split(/\s+/)
    .filter(Boolean)
    .at(-1)
    ?.toLowerCase()
    .replace(/[^a-z]/g, '')

  const suspiciousTerminal =
    terminal.length === 0 ||
    !lastWord ||
    TRAILING_CONNECTORS.has(lastWord) ||
    /ly$/.test(lastWord) ||
    ['else', 'also', 'still', 'now', 'then', 'too', 'instead', 'anymore', 'again'].includes(
      lastWord,
    )

  if (!suspiciousTerminal) return value

  const stripped = value.slice(0, match.index).trim()
  if (stripped.length < Math.floor(value.length * 0.45)) return value
  return stripped
}

function stripTrailingConnectors(value: string): string {
  const words = value.split(/\s+/).filter(Boolean)
  while (words.length > 6) {
    const lastWord =
      words
        .at(-1)
        ?.toLowerCase()
        .replace(/[^a-z]/g, '') ?? ''
    if (!TRAILING_CONNECTORS.has(lastWord)) break
    words.pop()
  }
  return words.join(' ').trim()
}

export function normalizeSummaryForStorage(input: string, maxLength = 300): string {
  const normalized = collapseWhitespace(input)
  if (hasMetaSummaryVoice(normalized)) return ''
  const base = trimToReadableLength(normalized, maxLength)
  if (!base) return ''
  const withoutDanglingClause = stripDanglingTrailingClause(base)
  if (withoutDanglingClause !== base) {
    return normalizeSummaryForStorage(withoutDanglingClause, maxLength)
  }
  if (hasTerminalExcerptEnding(base)) return base

  const wasLengthTrimmed = normalized.length > maxLength || /(?:\.\.\.|…)$/.test(base)
  let out = base.replace(/\.\.\.+$/g, '').trimEnd()
  const hadDanglingPunctuation = /[,:;\-–—]$/.test(out)
  out = trimToLastSentenceBoundary(out, wasLengthTrimmed || hadDanglingPunctuation ? 0.35 : 0.55)
  out = stripDanglingTrailingClause(out)
  out = out.replace(/[,:;\-–—]+$/g, '').trimEnd()
  out = stripTrailingConnectors(out)

  if (!out) return base
  if (!hasTerminalExcerptEnding(out)) {
    out = `${out}.`
  }

  let finalText = trimToReadableLength(out, maxLength)
  finalText = finalText.replace(/\.{2,}$/g, '.')
  if (finalText.endsWith('...')) {
    finalText = `${finalText
      .slice(0, -3)
      .trimEnd()
      .replace(/[,:;\-–—]+$/g, '')}.`
    finalText = trimToReadableLength(finalText, maxLength)
  }
  if (hasMetaSummaryVoice(finalText)) return ''
  return finalText
}

export function normalizeOptionalSummaryForStorage(
  input: string | null | undefined,
  maxLength = 300,
): string | undefined {
  if (typeof input !== 'string') return undefined
  const normalized = normalizeSummaryForStorage(input, maxLength)
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeExcerptForStorage(input: string, maxLength = 300): string {
  return normalizeSummaryForStorage(input, maxLength)
}

export function normalizeOptionalExcerptForStorage(
  input: string | null | undefined,
  maxLength = 300,
): string | undefined {
  return normalizeOptionalSummaryForStorage(input, maxLength)
}
