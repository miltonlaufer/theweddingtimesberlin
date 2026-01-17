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

function toPhotoRealisticPrompt(prompt: string): string {
  const trimmed = prompt.trim()
  const suffix =
    'Photo-realistic. Shadows, pores, dirtiness, hallow depth of field when possible. Natural lighting, realistic colors, high detail, no text.'

  if (!trimmed) {
    return suffix
  }

  const separator = trimmed.endsWith('.') ? ' ' : '. '
  return `${trimmed}${separator}${suffix}`
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
  const imageModel = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1'

  if (!openaiKey || !supabaseUrl || !supabaseServiceRole || !bucket) {
    throw new Error('Missing required env vars for image upload')
  }

  const openai = new OpenAI({ apiKey: openaiKey })
  const safeName = sanitizeFileBaseName(input.fileBaseName)
  const objectPath = `${nowPathPrefix()}/${safeName}-${Date.now()}.png`
  const imagePrompt = toPhotoRealisticPrompt(input.prompt)

  const generateWithModel = async (model: string) => {
    const baseRequest = {
      model,
      prompt: imagePrompt,
      size: '1024x1024',
    } as const

    if (model === 'dall-e-3') {
      return await openai.images.generate({
        ...baseRequest,
        style: 'natural',
      })
    }

    return await openai.images.generate(baseRequest)
  }

  let imageRes: Awaited<ReturnType<typeof generateWithModel>>
  try {
    imageRes = await generateWithModel(imageModel)
  } catch (e) {
    // Fallback: if a user picked a restricted model, try a more broadly available one.
    if (imageModel !== 'dall-e-3') {
      imageRes = await generateWithModel('dall-e-3')
    } else {
      throw e
    }
  }

  const first = imageRes.data?.[0]
  const imageUrl = first?.url ?? null
  const hasB64 = typeof (first as { b64_json?: unknown } | undefined)?.b64_json === 'string'
  let bytes: ArrayBuffer
  if (imageUrl) {
    bytes = await imageUrlToArrayBuffer(imageUrl)
  } else if (hasB64) {
    const b64 = (first as { b64_json: string }).b64_json
    bytes = Buffer.from(b64, 'base64').buffer
  } else {
    throw new Error('OpenAI image generation returned neither url nor b64_json')
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const uploadRes = await supabase.storage.from(bucket).upload(objectPath, bytes, {
    contentType: 'image/png',
    upsert: true,
  })

  if (uploadRes.error) {
    throw new Error(`Supabase upload failed: ${uploadRes.error.message}`)
  }

  const publicRes = supabase.storage.from(bucket).getPublicUrl(objectPath)
  const publicUrl = publicRes.data.publicUrl

  return {
    objectPath,
    publicUrl,
  }
}
