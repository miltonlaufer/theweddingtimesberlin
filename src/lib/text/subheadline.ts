import { trimToReadableLength } from './trimToReadableLength'

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeSubheadlineForStorage(input: string, maxLength = 220): string {
  return trimToReadableLength(collapseWhitespace(input), maxLength)
}

export function normalizeOptionalSubheadlineForStorage(
  input: string | null | undefined,
  maxLength = 220,
): string | undefined {
  if (typeof input !== 'string') return undefined
  const normalized = normalizeSubheadlineForStorage(input, maxLength)
  return normalized.length > 0 ? normalized : undefined
}
