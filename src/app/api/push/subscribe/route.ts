import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      subscription: PushSubscriptionJSON
      userAgent?: string
    }

    if (!body.subscription || !body.subscription.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription data' }, { status: 400 })
    }

    const payload = await getPayload()
    if (!payload) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    // Check if subscription already exists
    const existing = await payload.find({
      collection: 'push-subscriptions',
      where: {
        endpoint: { equals: body.subscription.endpoint },
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
          endpoint: body.subscription.endpoint,
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
