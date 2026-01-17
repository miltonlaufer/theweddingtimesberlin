import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      subscription: PushSubscriptionJSON
      userAgent?: string
    }

    // Validate subscription data
    if (!body?.subscription) {
      return NextResponse.json({ error: 'Missing subscription data' }, { status: 400 })
    }

    // Extract and validate endpoint
    const endpoint = body.subscription?.endpoint
    if (!endpoint) {
      console.error('Missing endpoint in subscription:', JSON.stringify(body.subscription, null, 2))
      return NextResponse.json({ error: 'Invalid or missing endpoint' }, { status: 400 })
    }

    if (typeof endpoint !== 'string') {
      console.error('Endpoint is not a string:', typeof endpoint, endpoint)
      return NextResponse.json({ error: 'Endpoint must be a string' }, { status: 400 })
    }

    const trimmedEndpoint = endpoint.trim()
    if (trimmedEndpoint.length === 0) {
      return NextResponse.json({ error: 'Endpoint cannot be empty' }, { status: 400 })
    }

    // Validate keys
    if (!body.subscription.keys || !body.subscription.keys.p256dh || !body.subscription.keys.auth) {
      return NextResponse.json({ error: 'Missing subscription keys' }, { status: 400 })
    }

    const payload = await getPayload()
    if (!payload) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    // Check if subscription already exists
    const existing = await payload.find({
      collection: 'push-subscriptions',
      where: {
        endpoint: { equals: trimmedEndpoint },
      },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      // Update existing subscription
      await payload.update({
        collection: 'push-subscriptions',
        id: existing.docs[0].id,
        data: {
          keys: body.subscription.keys,
          userAgent: body.userAgent || req.headers.get('user-agent') || undefined,
        },
      })
    } else {
      // Create new subscription
      await payload.create({
        collection: 'push-subscriptions',
        data: {
          endpoint: trimmedEndpoint,
          keys: body.subscription.keys,
          userAgent: body.userAgent || req.headers.get('user-agent') || undefined,
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Push subscription error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
