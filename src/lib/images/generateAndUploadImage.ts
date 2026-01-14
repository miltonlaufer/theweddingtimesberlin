import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

/******************* TYPES ***********************/

export interface UploadedImageResult {
  objectPath: string
  publicUrl: string
}

export interface GenerateAndUploadImageInput {
  prompt: string
  fileBaseName: string
}

/******************* LOGGING ***********************/

const LOG_ENDPOINT =
  'http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c'

function log(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'image-upload',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion agent log
}

/******************* HELPERS ***********************/

function sanitizeFileBaseName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function nowPathPrefix(): string {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}/${mm}/${dd}`
}

async function imageUrlToArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${res.statusText}`)
  return await res.arrayBuffer()
}

/******************* MAIN ***********************/

export async function generateAndUploadImage(
  input: GenerateAndUploadImageInput,
): Promise<UploadedImageResult> {
  // Hypotheses:
  // A: env vars missing at runtime
  // B: OpenAI image generation fails (quota/model)
  // C: Supabase upload fails (bucket/permissions)
  // D: Public URL generation fails (bucket privacy/policy)

  const openaiKey = process.env.OPENAI_API_KEY ?? ''
  const supabaseUrl = process.env.SUPABASE_URL ?? ''
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const bucket = process.env.SUPABASE_BUCKET ?? ''
  const imageModel = process.env.OPENAI_IMAGE_MODEL ?? 'dall-e-3'

  log('A', 'src/lib/images/generateAndUploadImage.ts:96', 'env_presence', {
    hasOpenAIKey: openaiKey.length > 0,
    hasSupabaseUrl: supabaseUrl.length > 0,
    hasServiceRoleKey: supabaseServiceRole.length > 0,
    hasBucket: bucket.length > 0,
    imageModel,
  })

  if (!openaiKey || !supabaseUrl || !supabaseServiceRole || !bucket) {
    throw new Error('Missing required env vars for image upload')
  }

  const openai = new OpenAI({ apiKey: openaiKey })
  const safeName = sanitizeFileBaseName(input.fileBaseName)
  const objectPath = `${nowPathPrefix()}/${safeName}-${Date.now()}.png`

  log('B', 'src/lib/images/generateAndUploadImage.ts:114', 'openai_image_request', {
    promptLen: input.prompt.length,
    objectPath,
  })

  const generateWithModel = async (model: string) => {
    return await openai.images.generate({
      model,
      prompt: input.prompt,
      size: '1024x1024',
    })
  }

  let imageRes: Awaited<ReturnType<typeof generateWithModel>>
  try {
    imageRes = await generateWithModel(imageModel)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error'
    log('B', 'src/lib/images/generateAndUploadImage.ts:135', 'openai_image_error', {
      model: imageModel,
      message,
    })

    // Fallback: if a user picked a restricted model, try a more broadly available one.
    if (imageModel !== 'dall-e-3') {
      imageRes = await generateWithModel('dall-e-3')
      log('B', 'src/lib/images/generateAndUploadImage.ts:144', 'openai_image_fallback_used', {
        fallbackModel: 'dall-e-3',
      })
    } else {
      throw e
    }
  }

  const first = imageRes.data?.[0]
  const imageUrl = first?.url ?? null
  const hasB64 = typeof (first as { b64_json?: unknown } | undefined)?.b64_json === 'string'
  log('B', 'src/lib/images/generateAndUploadImage.ts:129', 'openai_image_response', {
    hasUrl: Boolean(imageUrl),
    hasB64,
    dataLen: imageRes.data?.length ?? null,
  })

  let bytes: ArrayBuffer
  if (imageUrl) {
    bytes = await imageUrlToArrayBuffer(imageUrl)
  } else if (hasB64) {
    const b64 = (first as { b64_json: string }).b64_json
    bytes = Buffer.from(b64, 'base64').buffer
  } else {
    throw new Error('OpenAI image generation returned neither url nor b64_json')
  }

  log('B', 'src/lib/images/generateAndUploadImage.ts:138', 'downloaded_image', {
    byteLength: bytes.byteLength,
  })

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const uploadRes = await supabase.storage.from(bucket).upload(objectPath, bytes, {
    contentType: 'image/png',
    upsert: true,
  })

  log('C', 'src/lib/images/generateAndUploadImage.ts:153', 'supabase_upload_result', {
    ok: uploadRes.error == null,
    error: uploadRes.error?.message ?? null,
  })

  if (uploadRes.error) {
    throw new Error(`Supabase upload failed: ${uploadRes.error.message}`)
  }

  const publicRes = supabase.storage.from(bucket).getPublicUrl(objectPath)
  const publicUrl = publicRes.data.publicUrl

  log('D', 'src/lib/images/generateAndUploadImage.ts:168', 'public_url_result', {
    publicUrlHost: (() => {
      try {
        return new URL(publicUrl).host
      } catch {
        return 'invalid-url'
      }
    })(),
  })

  return {
    objectPath,
    publicUrl,
  }
}

