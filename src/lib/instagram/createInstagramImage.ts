/**
 * Creates a composite image for Instagram: base image + text overlay (title + summary)
 * with semi-opaque background. Uses the same headline font as the article page (Libre Baskerville).
 */

import path from 'path'
import fs from 'fs'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import sharp from 'sharp'
import { getStorageAdapter, CACHE_CONTROL_IMMUTABLE } from '@/lib/storage'

/******************* TYPES ***********************/

export interface CreateInstagramImageParams {
  imageUrl: string
  headline: string
  excerpt: string | null
}

export interface CreateAndUploadInstagramImageResult {
  publicUrl: string
  objectPath: string
}

/******************* CONSTANTS ***********************/

const HEADLINE_FONT_FAMILY = 'Libre Baskerville'
const FALLBACK_FONT_FAMILY = 'Georgia'
// Variable font (Regular weight); static LibreBaskerville-Regular.ttf was removed from google/fonts
const LIBRE_BASKERVILLE_TTF_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/librebaskerville/LibreBaskerville%5Bwght%5D.ttf'
const OVERLAY_BG = 'rgba(18, 18, 18, 0.72)'
const TEXT_COLOR = '#ffffff'
const PADDING_RATIO = 0.06
const TEXT_BLOCK_HEIGHT_RATIO = 0.42
const MIN_HEADLINE_FONT_PX = 28
const MIN_EXCERPT_FONT_PX = 18
const MAX_HEADLINE_FONT_PX = 72
const MAX_EXCERPT_FONT_PX = 36
const LINE_HEIGHT_HEADLINE = 1.2
const LINE_HEIGHT_EXCERPT = 1.35
const EXCERPT_TO_HEADLINE_SIZE_RATIO = 0.55
const GAP_HEADLINE_TO_EXCERPT_EM = 0.5

const MASTHEAD_TEXT = 'The Wedding Times'
const MASTHEAD_FONT_FAMILY = 'Chomsky'
const MASTHEAD_BAR_HEIGHT_RATIO = 0.09
const MASTHEAD_FONT_SIZE_MIN = 18
const MASTHEAD_FONT_SIZE_MAX = 42

let fontRegistered: boolean | null = null
let useFallbackFont = false
let mastheadFontRegistered = false

/******************* FONT ***********************/

function getLocalFontPath(): string {
  return path.join(process.cwd(), 'public', 'fonts', 'LibreBaskerville-Regular.ttf')
}

function getChomskyFontPath(): string {
  return path.join(process.cwd(), 'public', 'fonts', 'Chomsky.otf')
}

async function downloadFontToTmp(): Promise<string | null> {
  const tmpDir = process.env.TMPDIR ?? '/tmp'
  const dest = path.join(tmpDir, 'LibreBaskerville-wght.ttf')
  if (fs.existsSync(dest)) {
    return dest
  }
  const res = await fetch(LIBRE_BASKERVILLE_TTF_URL)
  if (!res.ok) {
    return null
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  return dest
}

async function ensureFontRegisteredAsync(): Promise<void> {
  if (fontRegistered === true) return
  const localPath = getLocalFontPath()
  if (fs.existsSync(localPath)) {
    GlobalFonts.registerFromPath(localPath, HEADLINE_FONT_FAMILY)
    fontRegistered = true
  } else {
    const tmpPath = await downloadFontToTmp()
    if (tmpPath) {
      GlobalFonts.registerFromPath(tmpPath, HEADLINE_FONT_FAMILY)
      fontRegistered = true
    } else {
      useFallbackFont = true
      fontRegistered = true
    }
  }
  if (!mastheadFontRegistered) {
    const chomskyPath = getChomskyFontPath()
    if (fs.existsSync(chomskyPath)) {
      GlobalFonts.registerFromPath(chomskyPath, MASTHEAD_FONT_FAMILY)
      mastheadFontRegistered = true
    }
  }
}

/******************* TEXT LAYOUT ***********************/

/**
 * Normalize punctuation/spacing that commonly renders as missing glyphs in IG overlays.
 */
export function sanitizeInstagramOverlayText(text: string): string {
  return text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeOptionalInstagramOverlayText(text: string | null): string | null {
  if (!text) return null
  const sanitized = sanitizeInstagramOverlayText(text)
  return sanitized.length > 0 ? sanitized : null
}

function wrapLines(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  ctx.font = font
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    const { width } = ctx.measureText(candidate)
    if (width <= maxWidth) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Find the largest headline font size (within min/max) such that headline + excerpt
 * fit in the available overlay height. Excerpt size is proportional to headline size.
 */
function findFittingFontSizes(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  fontFamily: string,
  innerWidth: number,
  availableHeight: number,
  headline: string,
  excerpt: string | null,
): { headlinePx: number; excerptPx: number; headlineLines: string[]; excerptLines: string[] } {
  let headlinePx = MIN_HEADLINE_FONT_PX
  let headlineLines: string[] = []
  let excerptLines: string[] = []
  let excerptPx = MIN_EXCERPT_FONT_PX

  for (let size = MAX_HEADLINE_FONT_PX; size >= MIN_HEADLINE_FONT_PX; size -= 2) {
    const exPx = Math.max(
      MIN_EXCERPT_FONT_PX,
      Math.min(MAX_EXCERPT_FONT_PX, Math.round(size * EXCERPT_TO_HEADLINE_SIZE_RATIO)),
    )
    const headlineFont = `italic bold ${size}px "${fontFamily}", Georgia, serif`
    const excerptFont = `italic ${exPx}px "${fontFamily}", Georgia, serif`
    const hLines = wrapLines(ctx, headline, innerWidth, headlineFont)
    const eLines = excerpt ? wrapLines(ctx, excerpt, innerWidth, excerptFont) : []
    const totalHeight =
      hLines.length * size * LINE_HEIGHT_HEADLINE +
      (eLines.length > 0
        ? size * GAP_HEADLINE_TO_EXCERPT_EM + eLines.length * exPx * LINE_HEIGHT_EXCERPT
        : 0)
    if (totalHeight <= availableHeight) {
      headlinePx = size
      excerptPx = exPx
      headlineLines = hLines
      excerptLines = eLines
      break
    }
  }

  if (headlineLines.length === 0) {
    headlineLines = wrapLines(
      ctx,
      headline,
      innerWidth,
      `italic bold ${headlinePx}px "${fontFamily}", Georgia, serif`,
    )
    excerptLines = excerpt
      ? wrapLines(ctx, excerpt, innerWidth, `italic ${excerptPx}px "${fontFamily}", Georgia, serif`)
      : []
  }

  return { headlinePx, excerptPx, headlineLines, excerptLines }
}

/******************* OVERLAY ***********************/

/**
 * Uses headline font if registered; otherwise Georgia (after ensureFontRegisteredAsync).
 * Font size is chosen so that headline + excerpt fit in the overlay (italic).
 */
function createTextOverlayBuffer(
  width: number,
  height: number,
  headline: string,
  excerpt: string | null,
): Buffer {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  const paddingX = Math.max(24, width * PADDING_RATIO)
  const paddingY = Math.max(24, height * PADDING_RATIO)
  const textBlockHeight = Math.floor(height * TEXT_BLOCK_HEIGHT_RATIO)
  const textBlockTop = height - textBlockHeight
  const innerWidth = width - paddingX * 2
  const innerLeft = paddingX
  const innerTop = textBlockTop + paddingY
  const availableHeight = textBlockHeight - paddingY * 2

  const fontFamily = useFallbackFont ? FALLBACK_FONT_FAMILY : HEADLINE_FONT_FAMILY
  const { headlinePx, excerptPx, headlineLines, excerptLines } = findFittingFontSizes(
    ctx,
    fontFamily,
    innerWidth,
    availableHeight,
    headline,
    excerpt,
  )

  const headlineFont = `italic bold ${headlinePx}px "${fontFamily}", Georgia, serif`
  const excerptFont = `italic ${excerptPx}px "${fontFamily}", Georgia, serif`

  const mastheadBarHeight = Math.floor(height * MASTHEAD_BAR_HEIGHT_RATIO)
  const mastheadFontPx = Math.min(
    MASTHEAD_FONT_SIZE_MAX,
    Math.max(MASTHEAD_FONT_SIZE_MIN, Math.round(width / 22)),
  )
  const mastheadFontFamily = mastheadFontRegistered ? MASTHEAD_FONT_FAMILY : 'Georgia'
  const mastheadFont = `normal ${mastheadFontPx}px "${mastheadFontFamily}", "Old English Text MT", serif`

  ctx.fillStyle = OVERLAY_BG
  ctx.fillRect(0, 0, width, mastheadBarHeight)
  ctx.fillRect(0, textBlockTop, width, textBlockHeight)
  ctx.fillStyle = TEXT_COLOR

  ctx.font = mastheadFont
  ctx.textAlign = 'center'
  const mastheadY = mastheadBarHeight / 2 + mastheadFontPx * 0.35 - 8
  ctx.fillText(MASTHEAD_TEXT, width / 2, mastheadY)
  ctx.textAlign = 'left'

  ctx.font = headlineFont
  const lineHeightHeadline = headlinePx * LINE_HEIGHT_HEADLINE
  let y = innerTop + headlinePx
  for (const line of headlineLines) {
    ctx.fillText(line, innerLeft, y)
    y += lineHeightHeadline
  }

  if (excerptLines.length > 0) {
    y += headlinePx * GAP_HEADLINE_TO_EXCERPT_EM
    ctx.font = excerptFont
    const lineHeightExcerpt = excerptPx * LINE_HEIGHT_EXCERPT
    for (const line of excerptLines) {
      ctx.fillText(line, innerLeft, y)
      y += lineHeightExcerpt
    }
  }

  return canvas.toBuffer('image/png')
}

/******************* MAIN ***********************/

async function imageUrlToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`)
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Create a composite image buffer: base image with title + summary overlaid
 * in a semi-opaque band at the bottom, using the article headline font (Libre Baskerville).
 */
export async function createInstagramImageBuffer(
  params: CreateInstagramImageParams,
): Promise<Buffer> {
  const { imageUrl, headline, excerpt } = params
  const safeHeadline = sanitizeInstagramOverlayText(headline)
  const safeExcerpt = sanitizeOptionalInstagramOverlayText(excerpt)
  await ensureFontRegisteredAsync()
  const imageBuffer = await imageUrlToBuffer(imageUrl)
  const meta = await sharp(imageBuffer).metadata()
  const width = meta.width ?? 1080
  const height = meta.height ?? 1080
  const overlayBuffer = createTextOverlayBuffer(width, height, safeHeadline, safeExcerpt)
  const composite = await sharp(imageBuffer)
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer()
  return composite
}

function nowPathPrefix(): string {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}/${mm}/${dd}`
}

function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/**
 * Create the composite image and upload it to storage. Returns the public URL
 * to use as image_url when posting to Instagram.
 */
export async function createAndUploadInstagramImage(
  params: CreateInstagramImageParams,
  slug: string,
): Promise<CreateAndUploadInstagramImageResult> {
  const adapter = getStorageAdapter()
  if (!adapter.isConfigured()) {
    throw new Error('Storage adapter is not configured. Cannot upload Instagram image.')
  }
  const buffer = await createInstagramImageBuffer(params)
  const safeSlug = sanitizeSlug(slug)
  const basePath = `instagram/${nowPathPrefix()}/${safeSlug}-${Date.now()}.png`
  await adapter.upload(buffer, basePath, {
    contentType: 'image/png',
    cacheControl: CACHE_CONTROL_IMMUTABLE,
    upsert: true,
  })
  const publicUrl = adapter.getPublicUrl(basePath)
  return { publicUrl, objectPath: basePath }
}
