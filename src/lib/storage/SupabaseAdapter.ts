import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { type StorageAdapter, type UploadOptions, CACHE_CONTROL_DEFAULT } from './StorageAdapter'

/******************* SUPABASE STORAGE ADAPTER ***********************/

/**
 * Storage adapter implementation for Supabase Storage.
 * Uses environment variables:
 * - SUPABASE_URL: The Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: The service role key for server-side operations
 * - SUPABASE_BUCKET: The storage bucket name
 */
export class SupabaseAdapter implements StorageAdapter {
  private client: SupabaseClient | null = null
  private readonly supabaseUrl: string
  private readonly supabaseServiceRole: string
  private readonly bucket: string

  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL ?? ''
    this.supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    this.bucket = process.env.SUPABASE_BUCKET ?? ''
  }

  /******************* HELPERS ***********************/

  private getClient(): SupabaseClient {
    if (!this.client) {
      if (!this.isConfigured()) {
        throw new Error(
          'SupabaseAdapter: Missing required env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET)',
        )
      }
      this.client = createClient(this.supabaseUrl, this.supabaseServiceRole, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    }
    return this.client
  }

  /******************* INTERFACE IMPLEMENTATION ***********************/

  isConfigured(): boolean {
    return Boolean(this.supabaseUrl && this.supabaseServiceRole && this.bucket)
  }

  async upload(buffer: Buffer | ArrayBuffer, path: string, options: UploadOptions): Promise<void> {
    const client = this.getClient()

    const uploadRes = await client.storage.from(this.bucket).upload(path, buffer, {
      contentType: options.contentType,
      upsert: options.upsert ?? true,
      cacheControl: options.cacheControl ?? CACHE_CONTROL_DEFAULT,
    })

    if (uploadRes.error) {
      throw new Error(`Supabase upload failed: ${uploadRes.error.message}`)
    }
  }

  getPublicUrl(path: string): string {
    const client = this.getClient()
    const publicRes = client.storage.from(this.bucket).getPublicUrl(path)
    return publicRes.data.publicUrl
  }

  async delete(path: string): Promise<void> {
    const client = this.getClient()

    const deleteRes = await client.storage.from(this.bucket).remove([path])

    if (deleteRes.error) {
      throw new Error(`Supabase delete failed: ${deleteRes.error.message}`)
    }
  }
}
