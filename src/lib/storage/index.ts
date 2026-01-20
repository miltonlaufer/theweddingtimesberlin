import type { StorageAdapter } from './StorageAdapter'
import { SupabaseAdapter } from './SupabaseAdapter'
import { CloudflareR2Adapter } from './CloudflareR2Adapter'

/******************* TYPES ***********************/

export type StorageProvider = 'supabase' | 'cloudflare'

/******************* URL UTILITIES ***********************/

/**
 * Timestamp threshold for WebP support.
 * Images uploaded after this timestamp have both PNG and WebP versions.
 * Format: Unix timestamp in milliseconds (appears in filename like `image-1737373200000.png`)
 *
 * Set to January 20, 2026 00:00:00 UTC (approximate deployment date of WebP support)
 */
const WEBP_SUPPORT_TIMESTAMP = 1737331200000 // 2026-01-20 00:00:00 UTC

/**
 * Extract timestamp from image filename if present.
 * Our images are named like: `article-slug-1737373200000.png`
 */
function extractTimestamp(url: string): number | null {
  // Match timestamp before the extension: -1234567890123.png or -1234567890123.webp
  const match = url.match(/-(\d{13})\.(png|webp)$/)
  if (match) {
    return parseInt(match[1], 10)
  }
  return null
}

/**
 * Check if an image URL supports WebP (was uploaded after WebP support was added).
 */
function supportsWebp(url: string): boolean {
  const timestamp = extractTimestamp(url)
  if (timestamp === null) {
    // No timestamp found - assume old image, don't convert
    return false
  }
  return timestamp >= WEBP_SUPPORT_TIMESTAMP
}

/**
 * Convert a PNG image URL to WebP format if the WebP version exists.
 * Only converts URLs for images uploaded after WebP support was added.
 *
 * @param url - The image URL (may be PNG or already WebP)
 * @returns The URL with .webp extension if supported, otherwise original URL
 */
export function toWebpUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined

  // Already WebP - return as-is
  if (url.endsWith('.webp')) {
    return url
  }

  // Only convert if the image was uploaded after WebP support was added
  if (url.endsWith('.png') && supportsWebp(url)) {
    return url.slice(0, -4) + '.webp'
  }

  return url
}

/**
 * Convert a WebP image URL back to PNG format.
 * Useful for fallback scenarios when WebP is not available.
 *
 * @param url - The image URL (may be WebP or already PNG)
 * @returns The URL with .png extension
 */
export function toPngUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  // Replace .webp extension with .png
  if (url.endsWith('.webp')) {
    return url.slice(0, -5) + '.png'
  }
  return url
}

/******************* FACTORY ***********************/

/**
 * Get the configured storage adapter based on STORAGE_PROVIDER env var.
 * Defaults to 'supabase' if not specified.
 *
 * @returns The appropriate StorageAdapter implementation
 * @throws Error if the selected adapter is not properly configured
 */
export function getStorageAdapter(): StorageAdapter {
  const provider = (process.env.STORAGE_PROVIDER ?? 'supabase') as StorageProvider

  switch (provider) {
    case 'cloudflare':
      return new CloudflareR2Adapter()
    case 'supabase':
    default:
      return new SupabaseAdapter()
  }
}

/**
 * Get the current storage provider name.
 * @returns The provider name from environment or 'supabase' as default
 */
export function getStorageProvider(): StorageProvider {
  return (process.env.STORAGE_PROVIDER ?? 'supabase') as StorageProvider
}

/******************* RE-EXPORTS ***********************/

export { type StorageAdapter, type UploadOptions, type UploadResult } from './StorageAdapter'
export { CACHE_CONTROL_IMMUTABLE, CACHE_CONTROL_DEFAULT } from './StorageAdapter'
export { SupabaseAdapter } from './SupabaseAdapter'
export { CloudflareR2Adapter } from './CloudflareR2Adapter'
