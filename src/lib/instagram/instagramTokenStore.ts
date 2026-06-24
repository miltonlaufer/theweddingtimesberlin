import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import type { Payload } from 'payload'
import { getPayload } from '@/lib/payload'

const CACHE_KEY = 'instagram-token-state:v1'
const CACHE_TYPE = 'blacklist-summary'
const ENCRYPTION_VERSION = 'v1'

type GenerationCacheDoc = {
  id: string | number
  summary?: string | null
}

type StoredInstagramTokenState = {
  encryptedAccessToken: string
  expiresAt?: string | null
  refreshedAt?: string | null
  tokenLength?: number
  tokenPrefix?: string
}

export type InstagramStoredAccessToken = {
  accessToken: string
  expiresAt?: string | null
  refreshedAt?: string | null
  source: 'stored'
}

export type InstagramTokenRefreshResult =
  | {
      ok: true
      accessToken: string
      expiresAt?: string
    }
  | {
      ok: false
      error: string
    }

function getEncryptionKey(): Buffer {
  const secret =
    process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.PAYLOAD_SECRET?.trim() ||
    'instagram-token-dev-fallback'

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
      tokenLength: typeof parsed.tokenLength === 'number' ? parsed.tokenLength : undefined,
      tokenPrefix: typeof parsed.tokenPrefix === 'string' ? parsed.tokenPrefix : undefined,
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
      source: 'stored',
    }
  } catch (error) {
    console.warn('[Instagram] Stored token read failed:', error)
    return null
  }
}

export async function writeStoredInstagramAccessToken(args: {
  accessToken: string
  expiresAt?: string
}): Promise<void> {
  const accessToken = args.accessToken.trim()
  if (!accessToken) return

  const payload = await getPayload()
  if (!payload) return

  const summary = JSON.stringify({
    encryptedAccessToken: encryptToken(accessToken),
    expiresAt: args.expiresAt ?? null,
    refreshedAt: new Date().toISOString(),
    tokenLength: accessToken.length,
    tokenPrefix: accessToken.slice(0, 4),
  } satisfies StoredInstagramTokenState)

  const data = {
    cacheType: CACHE_TYPE,
    cacheKey: CACHE_KEY,
    signature: CACHE_KEY,
    summary,
    articleCount: 0,
    expiresAt: args.expiresAt,
  }

  try {
    const existing = await findTokenStateDoc(payload)
    if (existing?.id != null) {
      await payload.update({
        collection: 'generation-cache',
        id: existing.id,
        data,
      })
      return
    }

    await payload.create({
      collection: 'generation-cache',
      data,
    })
  } catch (error) {
    console.warn('[Instagram] Stored token write failed:', error)
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
    const response = await fetch(url.toString(), { method: 'GET', cache: 'no-store' })
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

    await writeStoredInstagramAccessToken({
      accessToken: refreshedToken,
      expiresAt,
    })

    return {
      ok: true,
      accessToken: refreshedToken,
      expiresAt,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Instagram token refresh failed',
    }
  }
}
