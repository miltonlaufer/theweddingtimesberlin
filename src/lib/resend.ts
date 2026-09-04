import { CANONICAL_SITE_URL } from '@/lib/getBaseUrl'

const GENERATED_VERCEL_DOMAIN = '.vercel.app'

function productionCustomDomain(): string | null {
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase()
  if (!domain || domain === 'vercel.app' || domain.endsWith(GENERATED_VERCEL_DOMAIN)) return null
  return domain
}

export function getResendFromAddress(): string {
  const override = process.env.RESEND_FROM_ADDRESS?.trim()
  if (override) return override

  const domain = productionCustomDomain() ?? new URL(CANONICAL_SITE_URL).hostname
  return `no-reply@${domain}`
}
