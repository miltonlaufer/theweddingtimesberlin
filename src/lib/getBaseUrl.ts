export function getBaseUrl(): string {
  // Prefer explicit config (useful for local dev + previews)
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')

  // Vercel provides VERCEL_URL without protocol
  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, '')

  // Production fallback (never use localhost in production)
  if (process.env.NODE_ENV === 'production') {
    return 'https://theweddingtimesberlin.de'
  }

  // Local dev default (we run Next on 3050)
  return 'http://localhost:3050'
}

