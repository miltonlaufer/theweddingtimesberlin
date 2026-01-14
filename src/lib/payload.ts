import { getPayload as getPayloadFn, type Payload } from 'payload'
import config from '@payload-config'

let cachedPayload: Payload | null = null

export const getPayload = async (): Promise<Payload | null> => {
  if (cachedPayload) return cachedPayload

  try {
    cachedPayload = await getPayloadFn({ config })
    return cachedPayload
  } catch (error) {
    // DB unavailable (build time) - return null, caller should handle gracefully
    console.warn('Payload initialization failed (likely build time):', error)
    return null
  }
}
