import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import type { Payload } from 'payload'
import { getPayload } from '@/lib/payload'

const CACHE_KEY = 'instagram-token-state:v1'
const CACHE_TYPE = 'blacklist-summary'
const ENCRYPTION_VERSION = 'v1'
const TOKEN_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const FAILED_REFRESH_RETRY_MS = 24 * 60 * 60 * 1000
const META_REQUEST_TIMEOUT_MS = 10_000

type GenerationCacheDoc = {
  id: string | number
  summary?: string | null
}

type StoredInstagramTokenState = {
  encryptedAccessToken: string
  expiresAt?: string | null
  refreshedAt?: string | null
  nextRefreshAt?: string | null
}

export type InstagramStoredAccessToken = {
  accessToken: string
  expiresAt?: string | null
  refreshedAt?: string | null
  nextRefreshAt?: string | null
  source: 'stored'
}

export type InstagramTokenRefreshResult =
  | {
      ok: true
      accessToken: string
      expiresAt?: string
      persisted: boolean
    }
  | {
      ok: false
      error: string
    }

export type InstagramTokenMaintenanceResult =
  | { ok: true; action: 'seeded' | 'fresh' | 'refreshed' }
  | { ok: false; action: 'failed'; error: string }

export function isInstagramTokenRefreshDue(
  token: {
    refreshedAt?: string | null
    expiresAt?: string | null
    nextRefreshAt?: string | null
  },
  now = new Date(),
): boolean {
  const nowMs = now.getTime()
  if (token.nextRefreshAt) {
    const nextRefreshAtMs = new Date(token.nextRefreshAt).getTime()
    if (!Number.isFinite(nextRefreshAtMs)) return true
    if (nextRefreshAtMs > nowMs) return false
  }

  if (!token.refreshedAt) return true

  const refreshedAtMs = new Date(token.refreshedAt).getTime()
  if (!Number.isFinite(refreshedAtMs)) return true

  if (refreshedAtMs > nowMs) return true

  if (token.expiresAt) {
    const expiresAtMs = new Date(token.expiresAt).getTime()
    if (!Number.isFinite(expiresAtMs)) return true
    if (expiresAtMs - nowMs <= TOKEN_EXPIRY_SAFETY_WINDOW_MS) return true
  }

  return nowMs - refreshedAtMs >= TOKEN_REFRESH_INTERVAL_MS
}

function getEncryptionKey(): Buffer {
  const dedicatedSecret = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY?.trim()
  if (!dedicatedSecret && process.env.NODE_ENV === 'production') {
    throw new Error('INSTAGRAM_TOKEN_ENCRYPTION_KEY must be set in production')
  }

  const secret =
    dedicatedSecret || process.env.PAYLOAD_SECRET?.trim() || 'instagram-token-dev-fallback'

  return createHash('sha256').update(secret).digest()
}

function encryptToken(accessToken: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(accessToken, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

function decryptToken(encryptedAccessToken: string): string | null {
  const [version, ivRaw, tagRaw, ciphertextRaw] = encryptedAccessToken.split(':')
  if (version !== ENCRYPTION_VERSION || !ivRaw || !tagRaw || !ciphertextRaw) return null

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(ivRaw, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

function parseStoredState(summary: string | null | undefined): StoredInstagramTokenState | null {
  if (!summary) return null
  try {
    const parsed = JSON.parse(summary) as Partial<StoredInstagramTokenState>
    if (typeof parsed.encryptedAccessToken !== 'string') return null
    return {
      encryptedAccessToken: parsed.encryptedAccessToken,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
      refreshedAt: typeof parsed.refreshedAt === 'string' ? parsed.refreshedAt : null,
      nextRefreshAt: typeof parsed.nextRefreshAt === 'string' ? parsed.nextRefreshAt : null,
    }
  } catch {
    return null
  }
}

async function findTokenStateDoc(payload: Payload): Promise<GenerationCacheDoc | null> {
  const result = await payload.find({
    collection: 'generation-cache',
    where: { cacheKey: { equals: CACHE_KEY } },
    limit: 1,
    depth: 0,
  })

  return (result.docs[0] as GenerationCacheDoc | undefined) ?? null
}

export async function readStoredInstagramAccessToken(): Promise<InstagramStoredAccessToken | null> {
  const payload = await getPayload()
  if (!payload) return null

  try {
    const doc = await findTokenStateDoc(payload)
    const state = parseStoredState(doc?.summary)
    if (!state) return null

    const accessToken = decryptToken(state.encryptedAccessToken)
    if (!accessToken?.trim()) return null

    return {
      accessToken: accessToken.trim(),
      expiresAt: state.expiresAt ?? null,
      refreshedAt: state.refreshedAt ?? null,
      nextRefreshAt: state.nextRefreshAt ?? null,
      source: 'stored',
    }
  } catch (error) {
    console.warn('[Instagram] Stored token read failed:', error)
    return null
  }
}

export async function writeStoredInstagramAccessToken(args: {
  accessToken: string
  expiresAt?: string | null
  refreshedAt?: string | null
  nextRefreshAt?: string | null
}): Promise<boolean> {
  const accessToken = args.accessToken.trim()
  if (!accessToken) return false

  const payload = await getPayload()
  if (!payload) return false

  const summary = JSON.stringify({
    encryptedAccessToken: encryptToken(accessToken),
    expiresAt: args.expiresAt ?? null,
    refreshedAt: args.refreshedAt === undefined ? new Date().toISOString() : args.refreshedAt,
    nextRefreshAt: args.nextRefreshAt ?? null,
  } satisfies StoredInstagramTokenState)

  const data = {
    cacheType: CACHE_TYPE,
    cacheKey: CACHE_KEY,
    signature: CACHE_KEY,
    summary,
    articleCount: 0,
    expiresAt: args.expiresAt ?? null,
  }

  try {
    const existing = await findTokenStateDoc(payload)
    if (existing?.id != null) {
      await payload.update({
        collection: 'generation-cache',
        id: existing.id,
        data,
      })
      return true
    }

    await payload.create({
      collection: 'generation-cache',
      data,
    })
    return true
  } catch (error) {
    console.warn('[Instagram] Stored token write failed:', error)
    return false
  }
}

export async function maintainInstagramAccessToken(): Promise<InstagramTokenMaintenanceResult> {
  const stored = await readStoredInstagramAccessToken()
  if (stored) {
    if (!isInstagramTokenRefreshDue(stored)) {
      return { ok: true, action: 'fresh' }
    }

    const refreshed = await refreshInstagramAccessToken(stored.accessToken)
    if (!refreshed.ok) {
      await writeStoredInstagramAccessToken({
        accessToken: stored.accessToken,
        expiresAt: stored.expiresAt,
        refreshedAt: stored.refreshedAt,
        nextRefreshAt: new Date(Date.now() + FAILED_REFRESH_RETRY_MS).toISOString(),
      })
      return { ok: false, action: 'failed', error: refreshed.error }
    }
    if (!refreshed.persisted) {
      return {
        ok: false,
        action: 'failed',
        error: 'Instagram token refreshed but could not be persisted',
      }
    }

    return { ok: true, action: 'refreshed' }
  }

  const envToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim()
  if (!envToken) {
    return { ok: false, action: 'failed', error: 'Missing Instagram access token' }
  }

  const refreshed = await refreshInstagramAccessToken(envToken)
  if (!refreshed.ok) {
    const validation = await validateInstagramAccessToken(envToken)
    if (!validation.ok) {
      return { ok: false, action: 'failed', error: validation.error || refreshed.error }
    }

    const persisted = await writeStoredInstagramAccessToken({
      accessToken: envToken,
      refreshedAt: null,
      nextRefreshAt: new Date(Date.now() + FAILED_REFRESH_RETRY_MS).toISOString(),
    })
    if (!persisted) {
      return {
        ok: false,
        action: 'failed',
        error: 'Could not persist validated Instagram access token',
      }
    }
    return { ok: true, action: 'seeded' }
  }
  if (!refreshed.persisted) {
    return {
      ok: false,
      action: 'failed',
      error: 'Instagram token refreshed but could not be persisted',
    }
  }

  return { ok: true, action: 'refreshed' }
}

async function validateInstagramAccessToken(
  accessToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = new URL('https://graph.instagram.com/me')
  url.searchParams.set('fields', 'id')
  url.searchParams.set('access_token', accessToken)

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    })
    const data = (await response.json().catch(() => ({}))) as {
      id?: string
      error?: { message?: string }
    }
    if (!response.ok || !data.id) {
      return {
        ok: false,
        error: data.error?.message ?? response.statusText ?? 'Instagram token validation failed',
      }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Instagram token validation failed',
    }
  }
}

export async function refreshInstagramAccessToken(
  accessToken: string,
): Promise<InstagramTokenRefreshResult> {
  const token = accessToken.trim()
  if (!token) return { ok: false, error: 'Missing Instagram access token' }

  const url = new URL('https://graph.instagram.com/refresh_access_token')
  url.searchParams.set('grant_type', 'ig_refresh_token')
  url.searchParams.set('access_token', token)

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    })
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string
      expires_in?: number
      error?: { message?: string }
    }

    const refreshedToken = data.access_token?.trim()
    if (!response.ok || !refreshedToken) {
      return {
        ok: false,
        error: data.error?.message ?? response.statusText ?? 'Instagram token refresh failed',
      }
    }

    const expiresAt =
      typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined

    const persisted = await writeStoredInstagramAccessToken({
      accessToken: refreshedToken,
      expiresAt,
    })

    return {
      ok: true,
      accessToken: refreshedToken,
      expiresAt,
      persisted,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Instagram token refresh failed',
    }
  }
}
