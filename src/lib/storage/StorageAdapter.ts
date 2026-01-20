/******************* TYPES ***********************/

export interface UploadOptions {
  contentType: string
  cacheControl?: string
  upsert?: boolean
}

export interface UploadResult {
  objectPath: string
  publicUrl: string
}

/******************* INTERFACE ***********************/

/**
 * Abstract storage adapter interface for cloud storage providers.
 * Implementations can target Supabase Storage, Cloudflare R2, or other S3-compatible services.
 */
export interface StorageAdapter {
  /**
   * Upload a file to storage.
   * @param buffer - The file data to upload
   * @param path - The destination path in the bucket (e.g., "2025/01/20/image.webp")
   * @param options - Upload options including contentType, cacheControl, and upsert flag
   * @returns Promise that resolves when upload is complete
   */
  upload(buffer: Buffer | ArrayBuffer, path: string, options: UploadOptions): Promise<void>

  /**
   * Get the public URL for a stored object.
   * @param path - The object path in the bucket
   * @returns The full public URL to access the object
   */
  getPublicUrl(path: string): string

  /**
   * Delete an object from storage.
   * @param path - The object path to delete
   * @returns Promise that resolves when deletion is complete
   */
  delete(path: string): Promise<void>

  /**
   * Check if the adapter is properly configured.
   * @returns true if all required environment variables are set
   */
  isConfigured(): boolean
}

/******************* CONSTANTS ***********************/

/**
 * Maximum cache duration (1 year) - effectively immutable content.
 * Use this for images that will never change once uploaded.
 */
export const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Default cache duration (1 day) for content that might change.
 */
export const CACHE_CONTROL_DEFAULT = 'public, max-age=86400'
