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
const STYLE_CACHE = 'styles'
const SCRIPT_CACHE = 'scripts'
const FONT_CACHE = 'fonts'
const GOOGLE_FONT_STYLES_CACHE = 'google-font-styles'
const GOOGLE_FONT_FILES_CACHE = 'google-font-files'
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
    // Cache other navigations to support offline fallbacks.
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'pages-navigate',
        networkTimeoutSeconds: 4,
        plugins: [new CacheableResponsePlugin({ statuses: [200] })],
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
    // Cache stylesheets.
    {
      matcher: ({ request, url }) =>
        request.destination === 'style' || url.pathname.endsWith('.css'),
      handler: new StaleWhileRevalidate({
        cacheName: STYLE_CACHE,
        plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
      }),
    },
    // Cache scripts.
    {
      matcher: ({ request }) => request.destination === 'script',
      handler: new StaleWhileRevalidate({
        cacheName: SCRIPT_CACHE,
        plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
      }),
    },
    // Cache fonts with a long TTL.
    {
      matcher: ({ request, url }) =>
        request.destination === 'font' || /\.(woff2|woff|ttf|otf)$/.test(url.pathname),
      handler: new CacheFirst({
        cacheName: FONT_CACHE,
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
          }),
        ],
      }),
    },
    // Cache Google Fonts stylesheets.
    {
      matcher: ({ url }) => url.origin === 'https://fonts.googleapis.com',
      handler: new StaleWhileRevalidate({
        cacheName: GOOGLE_FONT_STYLES_CACHE,
        plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
      }),
    },
    // Cache Google Fonts files.
    {
      matcher: ({ url }) => url.origin === 'https://fonts.gstatic.com',
      handler: new CacheFirst({
        cacheName: GOOGLE_FONT_FILES_CACHE,
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 60,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
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
