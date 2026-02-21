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

export function hasTerminalExcerptEnding(value: string): boolean {
  const normalized = collapseWhitespace(value)
  if (/(?:\.\.\.|…)$/.test(normalized)) return false
  return TERMINAL_ENDING_RE.test(normalized)
}

function trimToLastSentenceBoundary(value: string): string {
  const matches = [...value.matchAll(/[.!?]["')\]]?\s+/g)]
  const last = matches.at(-1)
  if (!last) return value
  const sentenceEnd = (last.index ?? 0) + last[0].trimEnd().length
  if (sentenceEnd < Math.floor(value.length * 0.55)) return value
  return value.slice(0, sentenceEnd).trim()
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

export function normalizeExcerptForStorage(input: string, maxLength = 300): string {
  const base = trimToReadableLength(collapseWhitespace(input), maxLength)
  if (!base) return ''
  if (hasTerminalExcerptEnding(base)) return base

  let out = base.replace(/\.\.\.+$/g, '').trimEnd()
  out = trimToLastSentenceBoundary(out)
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
  return finalText
}
