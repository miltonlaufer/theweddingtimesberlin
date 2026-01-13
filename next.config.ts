import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'

const nextConfig: NextConfig = {
  experimental: {
    reactCompiler: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
    ],
  },
  // Ensure Payload packages are transpiled correctly
  transpilePackages: ['@payloadcms/next', '@payloadcms/ui', '@payloadcms/richtext-lexical'],
}

export default withPayload(nextConfig)
