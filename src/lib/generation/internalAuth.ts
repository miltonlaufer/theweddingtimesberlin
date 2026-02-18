function readProvidedToken(request: Request): string {
  const authHeader = request.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const xCronSecret = request.headers.get('x-cron-secret')?.trim() ?? ''
  return bearer || xCronSecret || ''
}

export function getInternalCronSecret(): string {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? ''
  return cronSecret
}

export function getProvidedInternalCronToken(request: Request): string | undefined {
  const token = readProvidedToken(request)
  return token || undefined
}

export function getInternalCronTokenForCalls(request: Request): string | undefined {
  const provided = readProvidedToken(request)
  if (provided) return provided
  const fallback = getInternalCronSecret()
  return fallback || undefined
}

export function isInternalCronAuthorized(request: Request): boolean {
  const isProd = process.env.NODE_ENV === 'production'
  const secret = getInternalCronSecret()

  if (!secret) {
    return !isProd
  }

  const provided = readProvidedToken(request)

  if (provided === secret) return true
  return !isProd
}

export function buildInternalAuthHeaders(secret: string | undefined): HeadersInit {
  const token = secret?.trim() ?? ''
  if (!token) return {}
  return {
    authorization: `Bearer ${token}`,
    'x-cron-secret': token,
  }
}
