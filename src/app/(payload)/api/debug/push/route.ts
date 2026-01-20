import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'

/**
 * Debug endpoint for testing push notifications
 *
 * GET: List all subscriptions and their status
 * POST: Send a test push notification to all subscribers
 */
export async function GET() {
  try {
    const payload = await getPayload()
    if (!payload) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    // Check VAPID configuration
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
    const vapidEmail = process.env.VAPID_EMAIL

    const vapidStatus = {
      publicKey: vapidPublicKey ? `${vapidPublicKey.slice(0, 20)}...` : 'NOT SET',
      privateKey: vapidPrivateKey ? 'SET (hidden)' : 'NOT SET',
      email: vapidEmail || 'NOT SET (will use default)',
    }

    // Get all subscriptions
    const subscriptionsRes = await payload.find({
      collection: 'push-subscriptions',
      limit: 100,
    })

    const subscriptions = subscriptionsRes.docs.map((doc) => {
      const sub = doc as {
        id: string
        endpoint: string
        keys: { p256dh?: string; auth?: string }
        userAgent?: string
        createdAt?: string
      }
      return {
        id: sub.id,
        endpoint: sub.endpoint?.slice(0, 60) + '...',
        hasP256dh: !!sub.keys?.p256dh,
        hasAuth: !!sub.keys?.auth,
        userAgent: sub.userAgent?.slice(0, 50),
        createdAt: sub.createdAt,
      }
    })

    return NextResponse.json({
      vapid: vapidStatus,
      subscriptionCount: subscriptionsRes.totalDocs,
      subscriptions,
    })
  } catch (error) {
    console.error('Debug push GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function POST() {
  try {
    // Check VAPID keys first
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
    const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@example.com'

    if (!vapidPublicKey || !vapidPrivateKey) {
      return NextResponse.json(
        {
          error: 'VAPID keys not configured',
          detail: {
            publicKey: vapidPublicKey ? 'SET' : 'NOT SET',
            privateKey: vapidPrivateKey ? 'SET' : 'NOT SET',
          },
        },
        { status: 500 },
      )
    }

    // Use web-push directly for more detailed debugging
    const webpush = await import('web-push')
    webpush.default.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey)

    const payload = await getPayload()
    if (!payload) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const subscriptionsRes = await payload.find({
      collection: 'push-subscriptions',
      limit: 100,
    })

    const subscriptions = subscriptionsRes.docs as Array<{
      id: string
      endpoint: string
      keys: { p256dh: string; auth: string }
    }>

    if (subscriptions.length === 0) {
      return NextResponse.json({ error: 'No subscriptions found' }, { status: 404 })
    }

    // Try with minimal payload
    const notificationPayload = JSON.stringify({
      title: 'Test',
    })

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          }

          console.log('[Debug Push] Sending to:', sub.endpoint.slice(0, 60) + '...')
          console.log('[Debug Push] Keys present:', {
            p256dh: !!sub.keys.p256dh,
            auth: !!sub.keys.auth,
          })

          const response = await webpush.default.sendNotification(
            pushSubscription,
            notificationPayload,
            {
              TTL: 60, // 60 seconds
              urgency: 'high',
            },
          )

          console.log('[Debug Push] Response:', {
            statusCode: response.statusCode,
            headers: response.headers,
            body: response.body,
          })

          return {
            success: true,
            id: sub.id,
            statusCode: response.statusCode,
            body: response.body,
          }
        } catch (error) {
          console.error('[Debug Push] Error:', error)
          const err = error as { statusCode?: number; body?: string; message?: string }
          return {
            success: false,
            id: sub.id,
            statusCode: err.statusCode,
            body: err.body,
            error: err.message,
          }
        }
      }),
    )

    const detailedResults = results.map((r) => {
      if (r.status === 'fulfilled') {
        return r.value
      }
      return { success: false, error: r.reason?.message || 'Unknown error' }
    })

    return NextResponse.json({
      sent: detailedResults.filter((r) => r.success).length,
      failed: detailedResults.filter((r) => !r.success).length,
      results: detailedResults,
    })
  } catch (error) {
    console.error('Debug push POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
