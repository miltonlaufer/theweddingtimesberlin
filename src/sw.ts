/// <reference lib="webworker" />

import { CacheableResponsePlugin, ExpirationPlugin, NetworkFirst, Serwist } from 'serwist'
import { defaultCache } from '@serwist/next/worker'

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: Array<{ url: string; revision?: string | null }>
}

/******************* CONSTANTS ***********************/

const ARTICLE_CACHE = 'pages-articles'
const OFFLINE_URL = '/offline'

/******************* SERWIST INSTANCE ***********************/

const serwist = new Serwist({
  precacheEntries: [...self.__SW_MANIFEST, OFFLINE_URL],
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // Avoid catching API/admin routes
    navigateFallbackDenylist: [/^\/api\//, /^\/admin/],
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Cache visited article pages for offline reading.
    {
      matcher: ({ request, url }) =>
        request.mode === 'navigate' && url.pathname.startsWith('/article/'),
      handler: new NetworkFirst({
        cacheName: ARTICLE_CACHE,
        networkTimeoutSeconds: 4,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({
            maxEntries: 80,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          }),
        ],
      }),
    },
    // Use Serwist's recommended Next.js caching rules for static assets.
    ...defaultCache,
  ],
})

serwist.setCatchHandler(async ({ request }) => {
  if (request.mode === 'navigate') {
    const cached = await caches.match(request)
    if (cached) {
      return cached
    }

    const offline = await serwist.matchPrecache(OFFLINE_URL)
    if (offline) {
      return offline
    }
  }

  return Response.error()
})

serwist.addEventListeners()
