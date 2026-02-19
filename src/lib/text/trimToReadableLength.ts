export function trimToReadableLength(input: string, maxLength: number): string {
  const normalized = input.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized

  const hardSlice = normalized.slice(0, maxLength)

  // Prefer ending at sentence boundaries when available near the cap.
  const sentenceMatches = [...hardSlice.matchAll(/[.!?]["')\]]?\s+/g)]
  const lastSentence = sentenceMatches.at(-1)
  if (lastSentence) {
    const sentenceEnd = (lastSentence.index ?? 0) + lastSentence[0].trimEnd().length
    if (sentenceEnd >= Math.floor(maxLength * 0.65)) {
      return hardSlice.slice(0, sentenceEnd).trim()
    }
  }

  // Fallback to nearest word boundary to avoid mid-word truncation.
  const lastSpace = hardSlice.lastIndexOf(' ')
  if (lastSpace >= Math.floor(maxLength * 0.65)) {
    const wordBoundary = hardSlice
      .slice(0, lastSpace)
      .trimEnd()
      .replace(/[,:;\-–—]+$/g, '')
    if (wordBoundary.length > 0) {
      const withEllipsis = `${wordBoundary}...`
      return withEllipsis.length <= maxLength ? withEllipsis : wordBoundary
    }
  }

  return hardSlice.trimEnd()
}
