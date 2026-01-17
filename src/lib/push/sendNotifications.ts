import { getPayload } from '@/lib/payload'
import webpush from 'web-push'

interface PushSubscription {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

/**
 * Send push notifications to all subscribed users
 */
export async function sendPushNotifications(
  title: string,
  options?: {
    body?: string
    icon?: string
    badge?: string
    url?: string
    tag?: string
  },
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const payload = await getPayload()
  if (!payload) {
    throw new Error('Database unavailable')
  }

  // Get VAPID keys from environment
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@example.com'

  if (!publicKey || !privateKey) {
    throw new Error(
      'VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.',
    )
  }

  // Configure web-push
  webpush.setVapidDetails(vapidEmail, publicKey, privateKey)

  // Get all active subscriptions
  const subscriptionsRes = await payload.find({
    collection: 'push-subscriptions',
    limit: 1000,
  })

  const subscriptions = subscriptionsRes.docs as Array<{
    id: string
    endpoint: string
    keys: { p256dh: string; auth: string }
  }>

  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, errors: [] }
  }

  const notificationPayload = JSON.stringify({
    title,
    body: options?.body || 'New articles have been published!',
    icon: options?.icon || '/logo-200x200.png',
    badge: options?.badge || '/logo-200x200.png',
    url: options?.url || '/',
    tag: options?.tag || 'new-articles',
  })

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        const pushSubscription: PushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
          },
        }

        await webpush.sendNotification(pushSubscription, notificationPayload)
        return { success: true, id: sub.id }
      } catch (error) {
        // If subscription is invalid (410 Gone), delete it
        if (error instanceof Error && 'statusCode' in error && error.statusCode === 410) {
          try {
            await payload.delete({
              collection: 'push-subscriptions',
              id: sub.id,
            })
          } catch {
            // Ignore deletion errors
          }
        }
        return {
          success: false,
          id: sub.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }),
  )

  const sent = results.filter((r) => r.status === 'fulfilled' && r.value.success).length
  const failed = results.length - sent
  const errors = results
    .filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
    .map((r) => {
      if (r.status === 'rejected') {
        return r.reason?.message || 'Unknown error'
      }
      return r.value.error || 'Unknown error'
    })

  return { sent, failed, errors }
}
