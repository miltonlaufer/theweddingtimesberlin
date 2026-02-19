import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { getPayload } from '../src/lib/payload'
import { trimToReadableLength } from '../src/lib/text/trimToReadableLength'

type ArticleDoc = {
  id: number | string
  headline?: string
  subheadline?: string | null
  excerpt?: string | null
  content?: unknown
}

function getArgValue(name: string): string | null {
  const prefix = `${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function formatPreview(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3)}...`
}

function toNumericId(value: number | string): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : -1
}

function extractLexicalText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''

  const chunks: string[] = []

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return

    const maybeText = (node as { text?: unknown }).text
    if (typeof maybeText === 'string' && maybeText.trim().length > 0) {
      chunks.push(maybeText.trim())
    }

    const children = (node as { children?: unknown }).children
    if (Array.isArray(children)) {
      for (const child of children) walk(child)
    }

    const root = (node as { root?: unknown }).root
    if (root) walk(root)
  }

  walk(value)
  return chunks.join(' ').replace(/\s+/g, ' ').trim()
}

function normalizeExcerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function isLikelyCutExcerpt(value: string): boolean {
  const excerpt = normalizeExcerpt(value)
  if (excerpt.length < 285) return false

  const endsWithTerminalPunctuation = /[.!?]["')\]]?$/.test(excerpt)
  if (endsWithTerminalPunctuation) return false

  // Typical truncation shape: near cap and ending in a bare word fragment.
  return /[A-Za-z0-9]$/.test(excerpt)
}

function buildRepairPrompt(article: ArticleDoc): string {
  const headline = article.headline?.trim() ?? ''
  const subheadline = article.subheadline?.trim() ?? ''
  const excerpt = article.excerpt?.trim() ?? ''
  const bodyText = extractLexicalText(article.content)
  const bodySnippet = bodyText.slice(0, 900)

  return [
    'Repair this article excerpt that was likely cut mid-word.',
    'Output only the repaired excerpt text.',
    'Rules:',
    '- Keep same premise and tone.',
    '- Keep it concrete, satirical, and readable.',
    '- Do not invent major facts that are not implied by context.',
    '- Maximum 300 characters.',
    '- End cleanly (prefer full sentence ending with punctuation).',
    '',
    `Headline: ${headline}`,
    subheadline ? `Subheadline: ${subheadline}` : 'Subheadline: (none)',
    `Current excerpt: ${excerpt}`,
    bodySnippet ? `Body context: ${bodySnippet}` : 'Body context: (none)',
  ].join('\n')
}

async function main(): Promise<void> {
  const fromId = Number(getArgValue('--from') ?? '636')
  const pageSize = Math.min(200, Math.max(20, Number(getArgValue('--page-size') ?? '80')))
  const dryRun = hasFlag('--dry-run') || !hasFlag('--apply')
  const forceAll = hasFlag('--force-all')
  const showText = hasFlag('--show-text')
  const logEvery = Math.max(10, Number(getArgValue('--log-every') ?? '50'))

  if (!Number.isFinite(fromId)) {
    throw new Error('Invalid --from value')
  }

  const payload = await getPayload()
  if (!payload) {
    throw new Error('Payload is unavailable')
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const modelName =
    process.env.OPENAI_EXCERPT_FIX_MODEL ??
    process.env.OPENAI_ANALYSIS_MODEL ??
    process.env.OPENAI_REPAIR_MODEL ??
    'gpt-4o-mini'

  const llm = new ChatOpenAI({
    apiKey,
    model: modelName,
  })

  console.log(
    `[fix-cut-excerpts] start | from=${fromId} pageSize=${pageSize} dryRun=${dryRun} forceAll=${forceAll} model=${modelName} showText=${showText}`,
  )

  let page = 1
  let scanned = 0
  let candidates = 0
  let repaired = 0
  let skippedUnchanged = 0

  while (true) {
    console.log(`[fix-cut-excerpts] fetching page=${page}`)
    const res = await payload.find({
      collection: 'articles',
      depth: 0,
      limit: pageSize,
      page,
      sort: 'id',
    })

    const docs = (res.docs as ArticleDoc[]).filter((doc) => toNumericId(doc.id) >= fromId)
    console.log(`[fix-cut-excerpts] page=${page} docsFromMinId=${docs.length}`)
    for (const doc of docs) {
      scanned += 1
      if (scanned % logEvery === 0) {
        console.log(
          `[fix-cut-excerpts] progress | scanned=${scanned} candidates=${candidates} repaired=${repaired} unchanged=${skippedUnchanged}`,
        )
      }
      const excerpt = typeof doc.excerpt === 'string' ? normalizeExcerpt(doc.excerpt) : ''
      if (!excerpt) continue

      const needsRepair = forceAll || isLikelyCutExcerpt(excerpt)
      if (!needsRepair) continue

      candidates += 1
      const prompt = buildRepairPrompt(doc)
      const raw = await llm.invoke([
        {
          role: 'system',
          content:
            'You are an editor fixing abruptly truncated newspaper excerpts. Return only the repaired excerpt.',
        },
        { role: 'user', content: prompt },
      ])

      const text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)
      const cleaned = trimToReadableLength(text.replace(/^\s*["']|["']\s*$/g, ''), 300)

      if (!cleaned || cleaned === excerpt) {
        skippedUnchanged += 1
        console.log(`[fix-cut-excerpts] id=${doc.id} skipped-unchanged`)
        continue
      }

      if (!dryRun) {
        await payload.update({
          collection: 'articles',
          id: doc.id,
          data: { excerpt: cleaned },
        })
      }

      repaired += 1
      console.log(
        `[fix-cut-excerpts] id=${doc.id} ${dryRun ? 'would-update' : 'updated'} | old=${excerpt.length} new=${cleaned.length}`,
      )
      if (showText) {
        console.log(`[fix-cut-excerpts] id=${doc.id} old: ${formatPreview(excerpt, 320)}`)
        console.log(`[fix-cut-excerpts] id=${doc.id} new: ${formatPreview(cleaned, 320)}`)
      }
    }

    if (!res.hasNextPage) break
    page += 1
  }

  console.log(
    `[fix-cut-excerpts] done | from=${fromId} scanned=${scanned} candidates=${candidates} repaired=${repaired} unchanged=${skippedUnchanged} dryRun=${dryRun} model=${modelName}`,
  )
}

main().catch((error) => {
  console.error('[fix-cut-excerpts] failed', error)
  process.exit(1)
})
