import { normalizeSummaryForStorage } from './excerptQuality'

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function stripMarkdownLinks(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~-]+/g, ' ')
}

function trimFallbackCandidate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized

  const hardSlice = normalized.slice(0, maxLength)
  const sentenceMatches = [...hardSlice.matchAll(/[.!?]["')\]]?\s+/g)]
  const lastSentence = sentenceMatches.at(-1)
  if (lastSentence) {
    const sentenceEnd = (lastSentence.index ?? 0) + lastSentence[0].trimEnd().length
    if (sentenceEnd >= Math.floor(maxLength * 0.45)) {
      return hardSlice.slice(0, sentenceEnd).trim()
    }
  }

  const clauseMatches = [...hardSlice.matchAll(/[,;:]|\s[\u2013\u2014]\s/g)]
  const lastClause = clauseMatches.at(-1)
  if (lastClause) {
    const clauseEnd = (lastClause.index ?? 0) + lastClause[0].length
    if (clauseEnd >= Math.floor(maxLength * 0.5)) {
      const clause = hardSlice
        .slice(0, clauseEnd)
        .replace(/[,:;\s-]+$/g, '')
        .trim()
      if (clause.length > 0) return `${clause}.`
    }
  }

  return hardSlice.trim()
}

function paragraphToSummary(paragraph: string, maxLength: number): string | undefined {
  const normalized = normalizeSummaryForStorage(
    trimFallbackCandidate(paragraph, maxLength),
    maxLength,
  )
  return normalized.length > 0 ? normalized : undefined
}

export function buildSummaryFromHtmlContent(
  html: string | null | undefined,
  maxLength = 300,
): string | undefined {
  if (typeof html !== 'string' || html.trim().length === 0) return undefined

  const paragraphMatches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
  const candidates =
    paragraphMatches.length > 0 ? paragraphMatches.map((match) => match[1] ?? '') : [html]

  for (const candidate of candidates) {
    const text = decodeBasicEntities(candidate.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
    const summary = paragraphToSummary(text, maxLength)
    if (summary) return summary
  }

  return undefined
}

export function buildSummaryFromMarkdownContent(
  markdown: string | null | undefined,
  maxLength = 300,
): string | undefined {
  if (typeof markdown !== 'string' || markdown.trim().length === 0) return undefined

  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !/^#{1,6}\s/.test(paragraph))
    .map((paragraph) => stripMarkdownLinks(paragraph).replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)

  for (const paragraph of paragraphs) {
    const summary = paragraphToSummary(paragraph, maxLength)
    if (summary) return summary
  }

  return undefined
}
