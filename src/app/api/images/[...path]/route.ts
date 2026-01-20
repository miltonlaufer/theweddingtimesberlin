import { NextRequest, NextResponse } from 'next/server'
import { getStorageAdapter, CACHE_CONTROL_IMMUTABLE } from '@/lib/storage'

/******************* CONFIG ***********************/

/**
 * Image proxy route for hiding direct bucket URLs.
 *
 * When IMAGE_PROXY_ENABLED=true, images can be served through this route
 * instead of directly from the storage bucket. This prevents users from
 * seeing the actual bucket URL in their browser.
 *
 * Usage: /api/images/2025/01/20/my-image.webp
 *
 * Tradeoffs:
 * - Pro: Hides bucket URLs from end users
 * - Pro: Allows switching storage providers without changing URLs in database
 * - Con: Routes traffic through Vercel (may have bandwidth limits)
 * - Con: Adds latency for first request (before CDN caching)
 *
 * Best used with Cloudflare R2 which has free egress.
 */

const CONTENT_TYPE_MAP: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

/******************* HELPERS ***********************/

function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPE_MAP[ext] ?? 'application/octet-stream'
}

function isProxyEnabled(): boolean {
  return process.env.IMAGE_PROXY_ENABLED === 'true' || process.env.IMAGE_PROXY_ENABLED === '1'
}

/******************* ROUTE HANDLER ***********************/

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  // Check if proxy is enabled
  if (!isProxyEnabled()) {
    return NextResponse.json(
      { error: 'Image proxy is disabled. Set IMAGE_PROXY_ENABLED=true to enable.' },
      { status: 403 },
    )
  }

  const { path: pathSegments } = await context.params

  if (!pathSegments || pathSegments.length === 0) {
    return NextResponse.json({ error: 'No image path provided' }, { status: 400 })
  }

  // Reconstruct the full path
  const imagePath = pathSegments.join('/')

  // Security: prevent path traversal
  if (imagePath.includes('..') || imagePath.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  try {
    const adapter = getStorageAdapter()

    if (!adapter.isConfigured()) {
      return NextResponse.json({ error: 'Storage not configured' }, { status: 500 })
    }

    // Get the public URL and fetch the image
    const publicUrl = adapter.getPublicUrl(imagePath)

    const response = await fetch(publicUrl, {
      headers: {
        // Forward cache headers for CDN
        'Cache-Control': CACHE_CONTROL_IMMUTABLE,
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: response.status })
    }

    const imageBuffer = await response.arrayBuffer()
    const contentType = getContentType(imagePath)

    // Return the image with strong caching headers
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': CACHE_CONTROL_IMMUTABLE,
        // Allow CDN to cache
        'CDN-Cache-Control': CACHE_CONTROL_IMMUTABLE,
        // Vercel edge cache
        'Vercel-CDN-Cache-Control': CACHE_CONTROL_IMMUTABLE,
      },
    })
  } catch (error) {
    console.error('Image proxy error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
