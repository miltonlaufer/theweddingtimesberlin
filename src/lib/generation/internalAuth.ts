export function isInternalCronAuthorized(request: Request): boolean {
  const isProd = process.env.NODE_ENV === 'production'
  const secret = process.env.CRON_SECRET?.trim() ?? ''

  if (!secret) {
    return !isProd
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const xCronSecret = request.headers.get('x-cron-secret')?.trim() ?? ''

  if (bearer === secret || xCronSecret === secret) return true
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
