import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'
import withSerwistInit from '@serwist/next'

/******************* SERWIST (PWA) ***********************/

const withSerwist = withSerwistInit({
  // Only enable the service worker in production builds
  disable: process.env.NODE_ENV !== 'production',
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  // Cache pages as users navigate with next/link
  cacheOnNavigation: true,
  // When coming back online, refresh to get fresh content
  reloadOnOnline: true,
})

const nextConfig: NextConfig = {
  experimental: {
    reactCompiler: false,
  },
  images: {
    // Reduce the number of generated image sizes to limit variants
    // Default deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840]
    deviceSizes: [640, 750, 1080, 1920],
    // Default imageSizes: [16, 32, 48, 64, 96, 128, 256, 384]
    imageSizes: [16, 32, 64, 128, 256],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
      // Supabase Storage
      {
        protocol: 'https',
        hostname: 'gfelfolsdxjvxawvptwr.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      // Cloudflare R2 - using wildcard for custom domains
      // Set R2_PUBLIC_URL to your R2 bucket's public URL or custom domain
      {
        protocol: 'https',
        hostname: '*.r2.dev',
      },
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
    ],
  },
  // Ensure Payload packages are transpiled correctly
  transpilePackages: ['@payloadcms/next', '@payloadcms/ui', '@payloadcms/richtext-lexical'],
}

export default withSerwist(withPayload(nextConfig))
