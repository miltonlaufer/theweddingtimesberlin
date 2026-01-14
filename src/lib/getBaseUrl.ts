export function getBaseUrl(): string {
  // Prefer explicit config (useful for local dev + previews)
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')

  // Vercel provides VERCEL_URL without protocol
  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, '')

  // Local dev default (we run Next on 3050)
  return 'http://localhost:3050'
}

