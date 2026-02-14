'use client'

import { useEffect } from 'react'

/******************* COMPONENT ***********************/

export function DevServiceWorkerReset() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') {
      return
    }

    const unregisterServiceWorkers = async () => {
      if (!('serviceWorker' in navigator)) {
        return
      }

      try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.unregister()))
      } catch {
        // Ignore cleanup errors in development.
      }

      if (!('caches' in window)) {
        return
      }

      try {
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
      } catch {
        // Ignore cleanup errors in development.
      }
    }

    unregisterServiceWorkers()
  }, [])

  return null
}
