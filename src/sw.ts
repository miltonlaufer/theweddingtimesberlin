/// <reference lib="webworker" />

import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { Serwist } from 'serwist'
import { PageStrategy, preCachePage } from './pwa/custom-strategies'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const OFFLINE_PAGE = '/offline'

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Custom page strategy for article routes
    {
      matcher: ({ request, url }) =>
        request.mode === 'navigate' && url.pathname.startsWith('/article/'),
      handler: PageStrategy,
    },
    // Use Serwist's recommended Next.js caching rules for everything else
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: OFFLINE_PAGE,
        matcher({ request }) {
          return request.destination === 'document'
        },
      },
    ],
  },
})

// Pre-cache the offline page on install
self.addEventListener('install', () => {
  preCachePage(OFFLINE_PAGE, self)
})

serwist.addEventListeners()
