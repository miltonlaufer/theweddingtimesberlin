import { getPayload as getPayloadFn, type Payload } from 'payload'
import config from '@payload-config'

let cachedPayload: Payload | null = null
let payloadInitPromise: Promise<Payload | null> | null = null

export const resetPayload = (): void => {
  cachedPayload = null
  payloadInitPromise = null
}

export const getPayload = async (): Promise<Payload | null> => {
  const shouldCache = process.env.PAYLOAD_CACHE !== 'false'
  if (shouldCache && cachedPayload) return cachedPayload
  if (payloadInitPromise) return payloadInitPromise

  payloadInitPromise = (async () => {
    try {
      const payload = await getPayloadFn({ config })
      if (shouldCache) {
        cachedPayload = payload
      }
      return payload
    } catch (error) {
      // DB unavailable (build time) - return null, caller should handle gracefully
      console.warn('Payload initialization failed (likely build time):', error)
      return null
    } finally {
      payloadInitPromise = null
    }
  })()

  return payloadInitPromise
}
