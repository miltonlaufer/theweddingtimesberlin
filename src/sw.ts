/// <reference lib="webworker" />

import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist'

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: Array<{ url: string; revision?: string | null }>
}

/******************* CONSTANTS ***********************/

const ARTICLE_CACHE = 'pages-articles'
const IMAGE_CACHE = 'images'
const NEXT_STATIC_CACHE = 'next-static'

/******************* SERWIST INSTANCE ***********************/

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // If navigation fails and there is no cached page, show the offline page.
    navigateFallback: '/offline',
    navigateFallbackAllowlist: [/^\/article\//],
    // Avoid catching API/admin routes
    navigateFallbackDenylist: [/^\/api\//, /^\/admin/],
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Cache visited article pages for offline reading.
    {
      matcher: ({ request, url }) => request.mode === 'navigate' && url.pathname.startsWith('/article/'),
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
    // Cache images aggressively.
    {
      matcher: ({ request }) => request.destination === 'image',
      handler: new CacheFirst({
        cacheName: IMAGE_CACHE,
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 150,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          }),
        ],
      }),
    },
    // Cache Next static chunks.
    {
      matcher: ({ url }) => url.pathname.startsWith('/_next/static/'),
      handler: new StaleWhileRevalidate({
        cacheName: NEXT_STATIC_CACHE,
      }),
    },
  ],
})

serwist.addEventListeners()

