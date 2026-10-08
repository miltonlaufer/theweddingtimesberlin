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

function paragraphToSummary(paragraph: string, maxLength: number): string | undefined {
  const normalized = normalizeSummaryForStorage(paragraph, maxLength)
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
