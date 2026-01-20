import OpenAI from 'openai'
import sharp from 'sharp'
import { getStorageAdapter, CACHE_CONTROL_IMMUTABLE } from '@/lib/storage'

/******************* TYPES ***********************/

export interface UploadedImageResult {
  /** Path to the WebP image (primary format used) */
  objectPath: string
  /** Public URL to the WebP image */
  publicUrl: string
  /** Path to the PNG image (backup format) */
  pngObjectPath: string
  /** Public URL to the PNG image */
  pngPublicUrl: string
}

export interface GenerateAndUploadImageInput {
  prompt: string
  fileBaseName: string
}

/******************* CONSTANTS ***********************/

/** WebP quality setting (0-100). 85 provides good balance of quality and file size. */
const WEBP_QUALITY = 85

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
  const prefix =
    'Award-winning photojournalism, shot on Canon EOS R5 with 50mm f/1.4 lens. RAW unedited photo. '
  const suffix =
    ' CRITICAL: This must look like a real photograph, not digital art. Real human skin with visible pores, blemishes, and texture. Natural available light with authentic shadows. Shallow depth of field with bokeh. Slight film grain. Documentary style like Reuters or AP news photography. ABSOLUTELY NO illustration, NO cartoon, NO CGI, NO 3D render, NO digital painting, NO stylized art, NO anime, NO fantasy. No text overlays, no watermarks. IMPORTANT FOR PEOPLE: When people appear in the image, obscure their identities through NATURAL photographic techniques only - use shallow depth of field where background people are genuinely optically out of focus, capture natural motion blur from movement, show people from behind or in profile, use dramatic shadows that naturally obscure features, or frame shots so faces are partially cropped or blocked by objects. NEVER use artificial digital blur, pixelation, or smudging on faces - this looks fake. All face obscuring must look like it happened naturally through camera optics, lighting, or composition.'

  if (!trimmed) {
    return prefix + suffix
  }

  return `${prefix}${trimmed}${suffix}`
}

async function imageUrlToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${res.statusText}`)
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function convertToWebP(pngBuffer: Buffer): Promise<Buffer> {
  return await sharp(pngBuffer).webp({ quality: WEBP_QUALITY }).toBuffer()
}

/******************* MAIN ***********************/

export async function generateAndUploadImage(
  input: GenerateAndUploadImageInput,
): Promise<UploadedImageResult> {
  const openaiKey = process.env.OPENAI_API_KEY ?? ''
  const imageModel = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1.5'

  if (!openaiKey) {
    throw new Error('Missing OPENAI_API_KEY for image generation')
  }

  // Get storage adapter (Supabase or Cloudflare R2 based on env)
  const adapter = getStorageAdapter()

  if (!adapter.isConfigured()) {
    throw new Error('Storage adapter is not properly configured. Check environment variables.')
  }

  const openai = new OpenAI({ apiKey: openaiKey })
  const safeName = sanitizeFileBaseName(input.fileBaseName)
  const basePath = `${nowPathPrefix()}/${safeName}-${Date.now()}`
  const pngObjectPath = `${basePath}.png`
  const webpObjectPath = `${basePath}.webp`
  const imagePrompt = toPhotoRealisticPrompt(input.prompt)

  const generateWithModel = async (model: string) => {
    const baseRequest = {
      model,
      prompt: imagePrompt,
      size: '1024x1024' as const,
    }

    if (model === 'dall-e-3') {
      return await openai.images.generate({
        ...baseRequest,
        style: 'natural',
        quality: 'hd',
      })
    }

    // gpt-image-1.5 and similar models
    if (model.startsWith('gpt-image')) {
      return await openai.images.generate({
        ...baseRequest,
        quality: 'high',
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

  let pngBuffer: Buffer
  if (imageUrl) {
    pngBuffer = await imageUrlToBuffer(imageUrl)
  } else if (hasB64) {
    const b64 = (first as { b64_json: string }).b64_json
    pngBuffer = Buffer.from(b64, 'base64')
  } else {
    throw new Error('OpenAI image generation returned neither url nor b64_json')
  }

  // Convert PNG to WebP for smaller file size
  const webpBuffer = await convertToWebP(pngBuffer)

  // Upload both formats with immutable cache headers (1 year)
  // Upload in parallel for better performance
  await Promise.all([
    adapter.upload(pngBuffer, pngObjectPath, {
      contentType: 'image/png',
      cacheControl: CACHE_CONTROL_IMMUTABLE,
      upsert: true,
    }),
    adapter.upload(webpBuffer, webpObjectPath, {
      contentType: 'image/webp',
      cacheControl: CACHE_CONTROL_IMMUTABLE,
      upsert: true,
    }),
  ])

  // Return WebP as the primary URL (smaller file size)
  const publicUrl = adapter.getPublicUrl(webpObjectPath)
  const pngPublicUrl = adapter.getPublicUrl(pngObjectPath)

  return {
    objectPath: webpObjectPath,
    publicUrl,
    pngObjectPath,
    pngPublicUrl,
  }
}
