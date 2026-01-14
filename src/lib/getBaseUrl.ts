export function getBaseUrl(): string {
    // In production, ALWAYS use the production domain (not Vercel preview URLs)
    // This ensures Open Graph/Twitter cards always point to the canonical domain
    if (process.env.NODE_ENV === 'production') {
        return 'https://theweddingtimesberlin.de'
    }

    // Prefer explicit config (useful for local dev + previews)
    const explicit = process.env.NEXT_PUBLIC_SITE_URL
    if (explicit) return explicit.replace(/\/+$/, '')

    // Vercel provides VERCEL_URL without protocol (only use in non-production)
    const vercelUrl = process.env.VERCEL_URL
    if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, '')

    // Local dev default (we run Next on 3050)
    return 'http://localhost:3050'
}

