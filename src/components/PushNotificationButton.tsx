'use client'

import { useEffect, useState } from 'react'

export function PushNotificationButton() {
  const [isSupported, setIsSupported] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Check if push notifications are supported
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    ) {
      setIsSupported(true)
      checkSubscriptionStatus()
    }
  }, [])

  const checkSubscriptionStatus = async () => {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      setIsSubscribed(!!subscription)
    } catch (err) {
      console.error('Error checking subscription status:', err)
    }
  }

  const requestPermission = async (): Promise<NotificationPermission> => {
    if (!('Notification' in window)) {
      throw new Error('This browser does not support notifications')
    }

    let permission = Notification.permission

    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }

    if (permission !== 'granted') {
      throw new Error('Notification permission denied')
    }

    return permission
  }

  const subscribe = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Request notification permission
      await requestPermission()

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready

      // Get VAPID public key from environment (we'll create an API endpoint for this)
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
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to subscribe to push notifications'
      setError(errorMessage)
      console.error('Push subscription error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const unsubscribe = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        await subscription.unsubscribe()

        // Optionally notify server (you could create an endpoint for this)
        setIsSubscribed(false)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to unsubscribe'
      setError(errorMessage)
      console.error('Push unsubscribe error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  if (!isSupported) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div className="rounded bg-red-100 p-2 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}
      {isSubscribed ? (
        <button
          onClick={unsubscribe}
          disabled={isLoading}
          className="rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
        >
          {isLoading ? 'Unsubscribing...' : 'Disable Push Notifications'}
        </button>
      ) : (
        <button
          onClick={subscribe}
          disabled={isLoading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? 'Subscribing...' : 'Enable Push Notifications'}
        </button>
      )}
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
