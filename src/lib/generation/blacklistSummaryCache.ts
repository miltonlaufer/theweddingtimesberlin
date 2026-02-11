import { createHash } from 'crypto'
import type { Payload } from 'payload'

const CACHE_TYPE = 'blacklist-summary'
const CACHE_VERSION = 'v1'

function getPruneChance(): number {
  const raw = Number(process.env.BLACKLIST_SUMMARY_CACHE_PRUNE_CHANCE ?? '0.2')
  if (!Number.isFinite(raw)) return 0.2
  return Math.max(0, Math.min(1, raw))
}

function getPruneScanLimit(): number {
  const raw = Number(process.env.BLACKLIST_SUMMARY_CACHE_PRUNE_SCAN_LIMIT ?? '200')
  if (!Number.isFinite(raw) || raw <= 0) return 200
  return Math.max(20, Math.min(1000, Math.floor(raw)))
}

function shouldPruneNow(): boolean {
  return Math.random() < getPruneChance()
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function buildCacheKey(signature: string): string {
  return `${CACHE_TYPE}:${CACHE_VERSION}:${signature}`
}

function getTtlHours(): number {
  const raw = Number(process.env.BLACKLIST_SUMMARY_CACHE_TTL_HOURS ?? '24')
  if (!Number.isFinite(raw) || raw <= 0) return 24
  return raw
}

export function buildBlacklistSummarySignature(params: {
  titles: string[]
  excerpts?: string[]
}): string {
  const { titles, excerpts = [] } = params
  const normalized = titles.map((title, idx) => ({
    i: idx,
    t: normalizeText(title),
    e: normalizeText(excerpts[idx] ?? ''),
  }))

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

type CacheDoc = {
  id: string | number
  summary?: string
  expiresAt?: string | null
}

async function pruneExpiredCache(payload: Payload): Promise<number> {
  const nowMs = Date.now()
  const scanned = await payload.find({
    collection: 'generation-cache',
    where: { cacheType: { equals: CACHE_TYPE } },
    limit: getPruneScanLimit(),
    sort: 'expiresAt',
    depth: 0,
  })

  const docs = scanned.docs as CacheDoc[]
  const expired = docs.filter((doc) => {
    if (!doc.expiresAt) return false
    const ms = new Date(doc.expiresAt).getTime()
    return Number.isFinite(ms) && ms < nowMs
  })

  if (expired.length === 0) return 0

  await Promise.all(
    expired.map((doc) =>
      payload
        .delete({
          collection: 'generation-cache',
          id: doc.id,
        })
        .catch(() => undefined),
    ),
  )

  return expired.length
}

async function readCache(payload: Payload, cacheKey: string): Promise<string | null> {
  const existing = await payload.find({
    collection: 'generation-cache',
    where: { cacheKey: { equals: cacheKey } },
    limit: 1,
    sort: '-updatedAt',
    depth: 0,
  })

  const doc = existing.docs[0] as CacheDoc | undefined
  if (!doc?.summary) return null

  if (doc.expiresAt) {
    const expiresAtMs = new Date(doc.expiresAt).getTime()
    if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) return null
  }

  return doc.summary
}

async function writeCache(args: {
  payload: Payload
  cacheKey: string
  signature: string
  summary: string
  articleCount: number
}): Promise<void> {
  const { payload, cacheKey, signature, summary, articleCount } = args
  if (summary.trim().length === 0) return

  const ttlHours = getTtlHours()
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()

  const existing = await payload.find({
    collection: 'generation-cache',
    where: { cacheKey: { equals: cacheKey } },
    limit: 1,
    depth: 0,
  })

  const doc = existing.docs[0] as CacheDoc | undefined
  if (doc?.id != null) {
    await payload.update({
      collection: 'generation-cache',
      id: doc.id,
      data: {
        cacheType: CACHE_TYPE,
        cacheKey,
        signature,
        summary,
        articleCount,
        expiresAt,
      },
    })
    return
  }

  await payload.create({
    collection: 'generation-cache',
    data: {
      cacheType: CACHE_TYPE,
      cacheKey,
      signature,
      summary,
      articleCount,
      expiresAt,
    },
  })
}

export async function getOrComputeBlacklistSummary(args: {
  payload: Payload
  titles: string[]
  excerpts?: string[]
  computeSummary: () => Promise<string>
}): Promise<{ summary: string; cacheHit: boolean; signature: string }> {
  const { payload, titles, excerpts = [], computeSummary } = args
  if (titles.length === 0) {
    return { summary: '', cacheHit: false, signature: '' }
  }

  if (shouldPruneNow()) {
    try {
      await pruneExpiredCache(payload)
    } catch {
      // Cleanup failures should never block generation.
    }
  }

  const signature = buildBlacklistSummarySignature({ titles, excerpts })
  const cacheKey = buildCacheKey(signature)

  const cached = await readCache(payload, cacheKey)
  if (cached != null) {
    return { summary: cached, cacheHit: true, signature }
  }

  const summary = await computeSummary()

  try {
    await writeCache({
      payload,
      cacheKey,
      signature,
      summary,
      articleCount: titles.length,
    })
  } catch {
    // Cache write failures should never block article generation.
  }

  return { summary, cacheHit: false, signature }
}
