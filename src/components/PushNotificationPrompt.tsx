'use client'

import { useEffect, useState } from 'react'

const DISMISSED_KEY = 'push-notification-prompt-dismissed'
const DISMISSED_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days

export function PushNotificationPrompt() {
  const [isVisible, setIsVisible] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Check if push notifications are supported
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      return
    }

    setIsSupported(true)
    checkAndShowPrompt()
  }, [])

  const checkAndShowPrompt = async () => {
    try {
      // Check if user is already subscribed
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        setIsSubscribed(true)
        return
      }

      // Check if permission was already denied
      if (Notification.permission === 'denied') {
        return
      }

      // Check if user dismissed the prompt recently
      const dismissed = localStorage.getItem(DISMISSED_KEY)
      if (dismissed) {
        const dismissedTime = parseInt(dismissed, 10)
        const now = Date.now()
        if (now - dismissedTime < DISMISSED_DURATION) {
          return // Don't show if dismissed within last 7 days
        }
      }

      // Show prompt if permission is default (not yet asked)
      if (Notification.permission === 'default') {
        setIsVisible(true)
      }
    } catch (err) {
      console.error('Error checking push notification status:', err)
    }
  }

  const handleEnable = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Request notification permission
      const permission = await Notification.requestPermission()

      if (permission !== 'granted') {
        throw new Error('Notification permission denied')
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready

      // Get VAPID public key
      const response = await fetch('/api/push/vapid-public-key')
      if (!response.ok) {
        throw new Error('Failed to get VAPID public key')
      }

      const { publicKey } = (await response.json()) as { publicKey: string }

      // Convert VAPID key to Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(publicKey)

      // Subscribe to push notifications
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      })

      // Send subscription to server
      const subscribeResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userAgent: navigator.userAgent,
        }),
      })

      if (!subscribeResponse.ok) {
        throw new Error('Failed to register subscription')
      }

      setIsSubscribed(true)
      setIsVisible(false)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to enable push notifications'
      setError(errorMessage)
      console.error('Push subscription error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDismiss = () => {
    setIsVisible(false)
    // Remember dismissal for 7 days
    localStorage.setItem(DISMISSED_KEY, Date.now().toString())
  }

  if (!isSupported || isSubscribed || !isVisible) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        className="w-full max-w-md border border-[#121212] bg-white px-6 py-5 text-[#121212] shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
      >
        <h2 className="font-headline text-2xl font-bold">Stay Updated</h2>
        <p className="mt-3 font-serif text-base text-[#333]">
          Get notified when new articles are published. Never miss a satirical headline from The
          Wedding Times.
        </p>
        {error && (
          <div className="mt-3 rounded bg-red-100 p-2 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={handleEnable}
            disabled={isLoading}
            className="font-sans text-sm font-semibold px-4 py-2 border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Enabling...' : 'Enable Notifications'}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={isLoading}
            className="font-sans text-sm text-[#666] hover:text-[#121212] transition-colors disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
