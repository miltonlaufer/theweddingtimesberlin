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
const FALLBACK_IMAGE = '/logo-fallback.png'

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
      {
        url: FALLBACK_IMAGE,
        matcher({ request }) {
          return request.destination === 'image'
        },
      },
    ],
  },
})

// Pre-cache the offline page and fallback image on install
self.addEventListener('install', (event) => {
  preCachePage(OFFLINE_PAGE, self)

  // Pre-cache the fallback image
  event.waitUntil(
    caches.open('fallback-images').then((cache) => {
      return cache.add(FALLBACK_IMAGE)
    }),
  )
})

// Handle push notifications
self.addEventListener('push', (event: PushEvent) => {
  console.log('[SW] Push notification received')

  let notificationData: {
    title: string
    body?: string
    icon?: string
    badge?: string
    url?: string
    tag?: string
  } = {
    title: 'New articles published!',
    body: 'Check out the latest stories.',
    icon: '/logo-200x200.png',
    badge: '/logo-200x200.png',
    url: '/',
    tag: 'new-articles',
  }

  if (event.data) {
    try {
      const data = event.data.json() as {
        title?: string
        body?: string
        icon?: string
        badge?: string
        url?: string
        tag?: string
      }
      console.log('[SW] Push data:', data)
      notificationData = {
        title: data.title || notificationData.title,
        body: data.body || notificationData.body,
        icon: data.icon || notificationData.icon,
        badge: data.badge || notificationData.badge,
        url: data.url || notificationData.url,
        tag: data.tag || notificationData.tag,
      }
    } catch (err) {
      console.error('[SW] Failed to parse push data:', err)
      // If JSON parsing fails, use default notification
    }
  }

  const notificationTitle = notificationData.title
  const notificationOptions: NotificationOptions = {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    tag: notificationData.tag,
    data: {
      url: notificationData.url || '/',
    },
  }

  event.waitUntil(self.registration.showNotification(notificationTitle, notificationOptions))
})

// Handle notification clicks
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  console.log('[SW] Notification clicked')
  event.notification.close()

  const urlToOpen = (event.notification.data?.url as string) || '/'
  console.log('[SW] Opening URL:', urlToOpen)

  event.waitUntil(
    self.clients
      .matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      .then((clientList) => {
        // Check if there's already a window/tab open with the target URL
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus()
          }
        }
        // If not, open a new window/tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen)
        }
      }),
  )
})

serwist.addEventListeners()
