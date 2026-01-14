import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'

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

export default withPayload(nextConfig)
