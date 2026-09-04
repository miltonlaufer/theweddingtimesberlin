import { createHash } from 'crypto'
import { getPayload } from '@/lib/payload'
import { getResendFromAddress } from '@/lib/resend'

export type InstagramAlertKind = 'publish' | 'refresh'
const DEFAULT_ALERT_EMAIL = 'miltonlaufer@gmail.com'
const EMAIL_TIMEOUT_MS = 10_000
const PENDING_RETRY_DELAY_MS = 5 * 60 * 1000
const RESEND_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000
const ALERT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export type InstagramAlertResult = {
  sent: boolean
  deduplicated: boolean
}

type AlertStateDoc = {
  id: string | number
  summary?: string | null
}

type InstagramPayload = NonNullable<Awaited<ReturnType<typeof getPayload>>>

type HealthState = {
  status: 'healthy' | 'failing'
  failedAt?: string
  lastFailureAt?: string
  lastError?: string
  recoveredAt?: string
}

type AlertMessage = {
  to: string
  subject: string
  text: string
}

type DeliveryClaimState = {
  deliveryStatus: 'pending' | 'sent'
  deliveryAttempt: number
  kind: InstagramAlertKind
  claimedAt: string
  lastAttemptAt: string
  sentAt?: string
  message: AlertMessage
}

class IndeterminateEmailError extends Error {}

function alertSubject(kind: InstagramAlertKind): string {
  return kind === 'publish'
    ? '[Wedding Times Berlin] Instagram publishing failed'
    : '[Wedding Times Berlin] Instagram token refresh failed'
}

function dailyFailureKey(kind: InstagramAlertKind): string {
  return `instagram-alert:failure:${kind}:${new Date().toISOString().slice(0, 10)}`
}

function healthStateKey(kind: InstagramAlertKind): string {
  return `instagram-health-state:${kind}:v1`
}

function parseHealthState(summary: string | null | undefined): HealthState | null {
  if (!summary) return null
  try {
    const parsed = JSON.parse(summary) as Partial<HealthState>
    if (parsed.status !== 'healthy' && parsed.status !== 'failing') return null
    return parsed as HealthState
  } catch {
    return null
  }
}

function parseDeliveryClaim(summary: string | null | undefined): DeliveryClaimState | null {
  if (!summary) return null
  try {
    const parsed = JSON.parse(summary) as Partial<DeliveryClaimState>
    if (parsed.deliveryStatus !== 'pending' && parsed.deliveryStatus !== 'sent') return null
    if (!parsed.claimedAt || !parsed.lastAttemptAt || !parsed.message) return null
    if (!parsed.message.to || !parsed.message.subject || !parsed.message.text) return null
    return {
      ...(parsed as DeliveryClaimState),
      deliveryAttempt:
        typeof parsed.deliveryAttempt === 'number' && parsed.deliveryAttempt > 0
          ? parsed.deliveryAttempt
          : 1,
    }
  } catch {
    return null
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout?.()
      reject(new IndeterminateEmailError(`${label} timed out`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function findStateDoc(
  payload: InstagramPayload,
  cacheKey: string,
): Promise<AlertStateDoc | null> {
  const existing = await payload.find({
    collection: 'generation-cache',
    where: { cacheKey: { equals: cacheKey } },
    limit: 1,
    depth: 0,
  })
  return (existing.docs[0] as AlertStateDoc | undefined) ?? null
}

async function writeHealthState(
  payload: InstagramPayload,
  kind: InstagramAlertKind,
  state: HealthState,
): Promise<void> {
  const cacheKey = healthStateKey(kind)
  const data = {
    cacheType: 'blacklist-summary' as const,
    cacheKey,
    signature: cacheKey,
    summary: JSON.stringify(state),
    articleCount: 0,
  }
  const existing = await findStateDoc(payload, cacheKey)
  if (existing) {
    await payload.update({ collection: 'generation-cache', id: existing.id, data })
    return
  }
  await payload.create({ collection: 'generation-cache', data })
}

async function claimAlert(
  payload: InstagramPayload,
  cacheKey: string,
  state: DeliveryClaimState,
): Promise<{ claimed: boolean; doc: AlertStateDoc }> {
  const existing = await findStateDoc(payload, cacheKey)
  if (existing) return { claimed: false, doc: existing }

  try {
    const created = (await payload.create({
      collection: 'generation-cache',
      data: {
        cacheType: 'blacklist-summary',
        cacheKey,
        signature: cacheKey,
        summary: JSON.stringify(state),
        articleCount: 0,
        expiresAt: new Date(Date.now() + ALERT_RETENTION_MS).toISOString(),
      },
    })) as AlertStateDoc
    return { claimed: true, doc: created }
  } catch (errorCreatingClaim) {
    const raced = await findStateDoc(payload, cacheKey)
    if (raced) return { claimed: false, doc: raced }
    throw errorCreatingClaim
  }
}

async function writeDeliveryClaim(
  payload: InstagramPayload,
  docId: string | number,
  state: DeliveryClaimState,
): Promise<void> {
  await payload.update({
    collection: 'generation-cache',
    id: docId,
    data: { summary: JSON.stringify(state) },
  })
}

function hasDirectResendCredentials(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

function canRetryPendingClaim(state: DeliveryClaimState, nowMs: number): boolean {
  if (!hasDirectResendCredentials()) return false
  const claimedAtMs = new Date(state.claimedAt).getTime()
  const lastAttemptAtMs = new Date(state.lastAttemptAt).getTime()
  if (!Number.isFinite(claimedAtMs) || !Number.isFinite(lastAttemptAtMs)) return false
  return nowMs - lastAttemptAtMs >= PENDING_RETRY_DELAY_MS
}

async function prepareDeliveryAttempt(
  payload: InstagramPayload,
  cacheKey: string,
  kind: InstagramAlertKind,
  message: AlertMessage,
): Promise<
  | { attempt: true; doc: AlertStateDoc; state: DeliveryClaimState }
  | { attempt: false; status: 'invalid' | 'pending' | 'sent'; state?: DeliveryClaimState }
> {
  const now = new Date().toISOString()
  const proposed: DeliveryClaimState = {
    deliveryStatus: 'pending',
    deliveryAttempt: 1,
    kind,
    claimedAt: now,
    lastAttemptAt: now,
    message,
  }
  const claim = await claimAlert(payload, cacheKey, proposed)
  if (claim.claimed) return { attempt: true, doc: claim.doc, state: proposed }

  const existing = parseDeliveryClaim(claim.doc.summary)
  if (!existing) return { attempt: false, status: 'invalid' }
  if (existing.deliveryStatus === 'sent') {
    return { attempt: false, status: 'sent', state: existing }
  }
  if (!canRetryPendingClaim(existing, Date.now())) {
    return { attempt: false, status: 'pending', state: existing }
  }

  const claimedAtMs = new Date(existing.claimedAt).getTime()
  const rotateIdempotencyKey =
    Number.isFinite(claimedAtMs) && Date.now() - claimedAtMs >= RESEND_IDEMPOTENCY_WINDOW_MS
  const retryState: DeliveryClaimState = {
    ...existing,
    claimedAt: rotateIdempotencyKey ? now : existing.claimedAt,
    lastAttemptAt: now,
    deliveryAttempt: rotateIdempotencyKey ? existing.deliveryAttempt + 1 : existing.deliveryAttempt,
  }
  await writeDeliveryClaim(payload, claim.doc.id, retryState)
  return { attempt: true, doc: claim.doc, state: retryState }
}

function resendIdempotencyKey(cacheKey: string, deliveryAttempt: number): string {
  const digest = createHash('sha256').update(`${cacheKey}:${deliveryAttempt}`).digest('hex')
  return `wtb-instagram-${digest}`
}

async function sendAlertEmail(
  payload: InstagramPayload,
  cacheKey: string,
  state: DeliveryClaimState,
): Promise<void> {
  const { message } = state
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    await withTimeout(payload.sendEmail(message), EMAIL_TIMEOUT_MS, 'Instagram alert email')
    return
  }

  const fromAddress = getResendFromAddress()

  const controller = new AbortController()
  let response: Response
  let data: { id?: string; name?: string; message?: string }
  try {
    const result = await withTimeout(
      (async () => {
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': resendIdempotencyKey(cacheKey, state.deliveryAttempt),
          },
          body: JSON.stringify({
            from: `Wedding Times Berlin <${fromAddress}>`,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
          signal: controller.signal,
        })
        const resendData = (await resendResponse.json().catch(() => ({}))) as {
          id?: string
          name?: string
          message?: string
        }
        return { response: resendResponse, data: resendData }
      })(),
      EMAIL_TIMEOUT_MS,
      'Instagram alert email',
      () => controller.abort(),
    )
    response = result.response
    data = result.data
  } catch (error) {
    if (error instanceof IndeterminateEmailError) throw error
    throw new IndeterminateEmailError(
      error instanceof Error ? error.message : 'Resend request outcome is unknown',
    )
  }
  if (!response.ok || !data.id) {
    const messageText = data.message ?? response.statusText ?? 'Resend email failed'
    if (response.status === 409 && data.name === 'concurrent_idempotent_requests') {
      throw new IndeterminateEmailError(messageText)
    }
    throw new Error(messageText)
  }
}

async function deliverClaim(
  payload: InstagramPayload,
  cacheKey: string,
  doc: AlertStateDoc,
  state: DeliveryClaimState,
): Promise<void> {
  try {
    await sendAlertEmail(payload, cacheKey, state)
    const sentState: DeliveryClaimState = {
      ...state,
      deliveryStatus: 'sent',
      sentAt: new Date().toISOString(),
    }
    try {
      await writeDeliveryClaim(payload, doc.id, sentState)
    } catch (error) {
      throw new IndeterminateEmailError(
        error instanceof Error ? error.message : 'Could not record sent alert',
      )
    }
  } catch (error) {
    if (!(error instanceof IndeterminateEmailError)) {
      await payload.delete({ collection: 'generation-cache', id: doc.id }).catch(() => undefined)
    }
    throw error
  }
}

export async function recordInstagramIntegrationFailure(
  kind: InstagramAlertKind,
  error: string,
): Promise<InstagramAlertResult> {
  const recipient = process.env.INSTAGRAM_ALERT_EMAIL?.trim() || DEFAULT_ALERT_EMAIL
  const payload = await getPayload()
  if (!payload) return { sent: false, deduplicated: false }

  const now = new Date().toISOString()
  const previousStateDoc = await findStateDoc(payload, healthStateKey(kind))
  const previousState = parseHealthState(previousStateDoc?.summary)
  await writeHealthState(payload, kind, {
    status: 'failing',
    failedAt: previousState?.status === 'failing' ? previousState.failedAt : now,
    lastFailureAt: now,
    lastError: error,
  })

  const cacheKey = dailyFailureKey(kind)
  const message: AlertMessage = {
    to: recipient,
    subject: alertSubject(kind),
    text: [
      `Instagram ${kind === 'publish' ? 'publishing' : 'token refresh'} failed.`,
      '',
      error.trim() || 'Unknown error',
      '',
      `Time: ${now}`,
    ].join('\n'),
  }
  const delivery = await prepareDeliveryAttempt(payload, cacheKey, kind, message)
  if (!delivery.attempt) return { sent: false, deduplicated: true }

  await deliverClaim(payload, cacheKey, delivery.doc, delivery.state)
  return { sent: true, deduplicated: false }
}

export async function recordInstagramIntegrationRecovery(
  kind: InstagramAlertKind,
): Promise<InstagramAlertResult> {
  const recipient = process.env.INSTAGRAM_ALERT_EMAIL?.trim() || DEFAULT_ALERT_EMAIL
  const payload = await getPayload()
  if (!payload) return { sent: false, deduplicated: false }

  const stateDoc = await findStateDoc(payload, healthStateKey(kind))
  const state = parseHealthState(stateDoc?.summary)
  if (state?.status !== 'failing' || !state.failedAt) {
    return { sent: false, deduplicated: true }
  }

  const recoveredAt = new Date().toISOString()
  const cacheKey = `instagram-alert:recovery:${kind}:${state.failedAt}`
  const message: AlertMessage = {
    to: recipient,
    subject:
      kind === 'publish'
        ? '[Wedding Times Berlin] Instagram publishing recovered'
        : '[Wedding Times Berlin] Instagram token refresh recovered',
    text: [
      `Instagram ${kind === 'publish' ? 'publishing' : 'token refresh'} is working again.`,
      '',
      `Recovered at: ${recoveredAt}`,
    ].join('\n'),
  }
  const delivery = await prepareDeliveryAttempt(payload, cacheKey, kind, message)
  if (!delivery.attempt) {
    if (delivery.status === 'sent') {
      await writeHealthState(payload, kind, {
        ...state,
        status: 'healthy',
        recoveredAt: delivery.state?.sentAt ?? recoveredAt,
      })
    }
    return { sent: false, deduplicated: true }
  }

  await deliverClaim(payload, cacheKey, delivery.doc, delivery.state)
  await writeHealthState(payload, kind, {
    ...state,
    status: 'healthy',
    recoveredAt,
  })
  return { sent: true, deduplicated: false }
}
