import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
}))

vi.mock('@/lib/payload', () => ({
  getPayload: mocks.getPayload,
}))

describe('Instagram integration alerts', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'))
    process.env = {
      ...originalEnv,
      INSTAGRAM_ALERT_EMAIL: 'milton@example.com',
      RESEND_API_KEY: '',
      RESEND_FROM_ADDRESS: '',
      VERCEL_PROJECT_PRODUCTION_URL: '',
    }
    mocks.getPayload.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('emails the configured recipient on the first publishing failure', async () => {
    const docs: Array<Record<string, unknown>> = []
    const sentEmails: Array<Record<string, unknown>> = []
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        docs.push({ id: docs.length + 1, ...data })
        return docs.at(-1)
      }),
      update: vi.fn(),
      delete: vi.fn(),
      sendEmail: vi.fn(async (message: Record<string, unknown>) => {
        sentEmails.push(message)
        return { id: 'email-1' }
      }),
    })

    const modulePath = './instagramAlerts'
    const alerts = await import(/* @vite-ignore */ modulePath).catch(() => null)
    const result = await alerts?.recordInstagramIntegrationFailure?.(
      'publish',
      'Access token rejected',
    )

    expect(result).toEqual({ sent: true, deduplicated: false })
    expect(sentEmails).toEqual([
      expect.objectContaining({
        to: 'milton@example.com',
        subject: '[Wedding Times Berlin] Instagram publishing failed',
        text: expect.stringContaining('Access token rejected'),
      }),
    ])
  })

  it('sends at most one failure email per kind per day', async () => {
    const docs: Array<Record<string, unknown>> = []
    const sentEmails: Array<Record<string, unknown>> = []
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (docs.some((doc) => doc.cacheKey === data.cacheKey)) {
          throw new Error('duplicate key')
        }
        docs.push({ id: docs.length + 1, ...data })
        return docs.at(-1)
      }),
      update: vi.fn(),
      delete: vi.fn(),
      sendEmail: vi.fn(async (message: Record<string, unknown>) => {
        sentEmails.push(message)
        return { id: `email-${sentEmails.length}` }
      }),
    })

    const modulePath = './instagramAlerts'
    const alerts = await import(/* @vite-ignore */ modulePath)
    const first = await alerts.recordInstagramIntegrationFailure('publish', 'First failure')
    const duplicate = await alerts.recordInstagramIntegrationFailure('publish', 'Repeated failure')

    expect(first).toEqual({ sent: true, deduplicated: false })
    expect(duplicate).toEqual({ sent: false, deduplicated: true })
    expect(sentEmails).toHaveLength(1)
  })

  it('sends one recovery email after a failing integration becomes healthy', async () => {
    const docs: Array<Record<string, unknown>> = []
    const sentEmails: Array<Record<string, unknown>> = []
    const payload = {
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (docs.some((doc) => doc.cacheKey === data.cacheKey)) {
          throw new Error('duplicate key')
        }
        const created = { id: docs.length + 1, ...data }
        docs.push(created)
        return created
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(async ({ id }: { id: number }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        if (index >= 0) docs.splice(index, 1)
      }),
      sendEmail: vi.fn(async (message: Record<string, unknown>) => {
        sentEmails.push(message)
        return { id: `email-${sentEmails.length}` }
      }),
    }
    mocks.getPayload.mockResolvedValue(payload)

    const modulePath = './instagramAlerts'
    const alerts = await import(/* @vite-ignore */ modulePath)
    await alerts.recordInstagramIntegrationFailure('publish', 'Token rejected')
    const recovered = await alerts.recordInstagramIntegrationRecovery?.('publish')
    const duplicate = await alerts.recordInstagramIntegrationRecovery?.('publish')

    expect(recovered).toEqual({ sent: true, deduplicated: false })
    expect(duplicate).toEqual({ sent: false, deduplicated: true })
    expect(sentEmails).toHaveLength(2)
    expect(sentEmails[1]).toEqual(
      expect.objectContaining({
        to: 'milton@example.com',
        subject: '[Wedding Times Berlin] Instagram publishing recovered',
      }),
    )
  })

  it('uses Milton’s address when no alert recipient is configured', async () => {
    delete process.env.INSTAGRAM_ALERT_EMAIL
    const docs: Array<Record<string, unknown>> = []
    const sentEmails: Array<Record<string, unknown>> = []
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: docs.length + 1, ...data }
        docs.push(created)
        return created
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(),
      sendEmail: vi.fn(async (message: Record<string, unknown>) => {
        sentEmails.push(message)
        return { id: 'email-1' }
      }),
    })

    const modulePath = './instagramAlerts'
    const alerts = await import(/* @vite-ignore */ modulePath)
    await alerts.recordInstagramIntegrationFailure('refresh', 'Refresh rejected')

    expect(sentEmails[0]).toEqual(
      expect.objectContaining({
        to: 'miltonlaufer@gmail.com',
      }),
    )
  })

  it('retains an indeterminate daily alert claim when email delivery times out', async () => {
    const docs: Array<Record<string, unknown>> = []
    const deletedIds: Array<string | number> = []
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: docs.length + 1, ...data }
        docs.push(created)
        return created
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(async ({ id }: { id: string | number }) => {
        deletedIds.push(id)
        const index = docs.findIndex((doc) => doc.id === id)
        if (index >= 0) docs.splice(index, 1)
      }),
      sendEmail: vi.fn(() => new Promise(() => undefined)),
    })

    const alerts = await import('./instagramAlerts')
    const attempt = alerts.recordInstagramIntegrationFailure('publish', 'Provider stalled')
    const expectation = expect(attempt).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation

    expect(deletedIds).not.toContain(1)
  })

  it('does not mark recovery healthy while the claimed email is still pending', async () => {
    const docs: Array<Record<string, unknown>> = []
    let finishRecoveryEmail: (() => void) | undefined
    let emailCount = 0
    const payload = {
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (docs.some((doc) => doc.cacheKey === data.cacheKey)) throw new Error('duplicate key')
        const created = { id: docs.length + 1, ...data }
        docs.push(created)
        return created
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(),
      sendEmail: vi.fn(() => {
        emailCount += 1
        if (emailCount === 1) return Promise.resolve({ id: 'failure-email' })
        return new Promise<{ id: string }>((resolve) => {
          finishRecoveryEmail = () => resolve({ id: 'recovery-email' })
        })
      }),
    }
    mocks.getPayload.mockResolvedValue(payload)

    const alerts = await import('./instagramAlerts')
    await alerts.recordInstagramIntegrationFailure('publish', 'Token rejected')
    const firstRecovery = alerts.recordInstagramIntegrationRecovery('publish')
    await Promise.resolve()
    await alerts.recordInstagramIntegrationRecovery('publish')

    const health = docs.find((doc) => doc.cacheKey === 'instagram-health-state:publish:v1')
    expect(JSON.parse(String(health?.summary))).toEqual(
      expect.objectContaining({ status: 'failing' }),
    )

    finishRecoveryEmail?.()
    await firstRecovery
  })

  it('uses a Resend idempotency key when direct credentials are configured', async () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.RESEND_FROM_ADDRESS = 'alerts@example.com'
    const docs: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'email-1' }))
    vi.stubGlobal('fetch', fetchMock)
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: docs.length + 1, ...data }
        docs.push(created)
        return created
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(async () => undefined),
      sendEmail: vi.fn(async () => ({ id: 'payload-email' })),
    })

    const alerts = await import('./instagramAlerts')
    await alerts.recordInstagramIntegrationFailure('refresh', 'Refresh rejected')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer re_test',
        'Idempotency-Key': expect.stringMatching(/^wtb-instagram-/),
      }),
    )
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        from: 'Wedding Times Berlin <alerts@example.com>',
      }),
    )
  })

  it('derives the direct Resend sender from the Vercel production custom domain', async () => {
    process.env.RESEND_API_KEY = 're_test'
    delete process.env.RESEND_FROM_ADDRESS
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'theweddingtimesberlin.de'
    const docs: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'email-1' }))
    vi.stubGlobal('fetch', fetchMock)
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: docs.length + 1, ...data }
        docs.push(created)
        return created
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(async () => undefined),
      sendEmail: vi.fn(async () => ({ id: 'payload-email' })),
    })

    const alerts = await import('./instagramAlerts')
    await alerts.recordInstagramIntegrationFailure('refresh', 'Refresh rejected')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        from: 'Wedding Times Berlin <no-reply@theweddingtimesberlin.de>',
      }),
    )
  })

  it('does not use a generated vercel.app domain as the Resend sender', async () => {
    process.env.RESEND_API_KEY = 're_test'
    delete process.env.RESEND_FROM_ADDRESS
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'theweddingtimesberlin.vercel.app'
    const docs: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'email-1' }))
    vi.stubGlobal('fetch', fetchMock)
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: docs.length + 1, ...data }
        docs.push(created)
        return created
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(async () => undefined),
      sendEmail: vi.fn(async () => ({ id: 'payload-email' })),
    })

    const alerts = await import('./instagramAlerts')
    await alerts.recordInstagramIntegrationFailure('refresh', 'Refresh rejected')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        from: 'Wedding Times Berlin <no-reply@theweddingtimesberlin.de>',
      }),
    )
  })

  it('times out a stalled Resend response body without deleting the claim', async () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.RESEND_FROM_ADDRESS = 'alerts@example.com'
    const docs: Array<Record<string, unknown>> = []
    const deletedIds: Array<string | number> = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: '',
        json: () => new Promise(() => undefined),
      }),
    )
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: docs.length + 1, ...data }
        docs.push(created)
        return created
      }),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(async ({ id }: { id: string | number }) => {
        deletedIds.push(id)
      }),
      sendEmail: vi.fn(),
    })

    const alerts = await import('./instagramAlerts')
    const attempt = alerts.recordInstagramIntegrationFailure('refresh', 'Refresh rejected')
    const expectation = expect(attempt).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation

    expect(deletedIds).toEqual([])
  })

  it('rotates the idempotency attempt for a recovery pending beyond 24 hours', async () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.RESEND_FROM_ADDRESS = 'alerts@example.com'
    const failedAt = '2026-09-02T12:00:00.000Z'
    const recoveryKey = `instagram-alert:recovery:publish:${failedAt}`
    const docs: Array<Record<string, unknown>> = [
      {
        id: 1,
        cacheKey: 'instagram-health-state:publish:v1',
        summary: JSON.stringify({ status: 'failing', failedAt }),
      },
      {
        id: 2,
        cacheKey: recoveryKey,
        summary: JSON.stringify({
          deliveryStatus: 'pending',
          deliveryAttempt: 1,
          kind: 'publish',
          claimedAt: failedAt,
          lastAttemptAt: failedAt,
          message: {
            to: 'milton@example.com',
            subject: '[Wedding Times Berlin] Instagram publishing recovered',
            text: 'Recovered',
          },
        }),
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'recovery-email' }))
    vi.stubGlobal('fetch', fetchMock)
    mocks.getPayload.mockResolvedValue({
      find: vi.fn(async ({ where }: { where?: { cacheKey?: { equals?: string } } }) => ({
        docs: docs.filter((doc) => doc.cacheKey === where?.cacheKey?.equals),
      })),
      create: vi.fn(),
      update: vi.fn(async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
        const index = docs.findIndex((doc) => doc.id === id)
        docs[index] = { ...docs[index], ...data }
        return docs[index]
      }),
      delete: vi.fn(),
      sendEmail: vi.fn(),
    })

    const alerts = await import('./instagramAlerts')
    const result = await alerts.recordInstagramIntegrationRecovery('publish')

    expect(result).toEqual({ sent: true, deduplicated: false })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(String(docs[1].summary))).toEqual(
      expect.objectContaining({ deliveryStatus: 'sent', deliveryAttempt: 2 }),
    )
  })
})
