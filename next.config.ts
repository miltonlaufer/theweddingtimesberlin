import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'
import withSerwistInit from '@serwist/next'

/******************* SERWIST (PWA) ***********************/

const withSerwist = withSerwistInit({
  // Only enable the service worker in production builds
  disable: process.env.NODE_ENV !== 'production',
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  // Precache all Next build assets generated into .next/static
  include: [/^static\/.*$/],
  // Ensure large font or media assets are allowed in the precache manifest.
  maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
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
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
      {
        protocol: 'https',
        hostname: 'gfelfolsdxjvxawvptwr.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Ensure Payload packages are transpiled correctly
  transpilePackages: ['@payloadcms/next', '@payloadcms/ui', '@payloadcms/richtext-lexical'],
}

export default withSerwist(withPayload(nextConfig))
