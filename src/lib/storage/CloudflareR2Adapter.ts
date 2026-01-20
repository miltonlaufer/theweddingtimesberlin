import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import { type StorageAdapter, type UploadOptions, CACHE_CONTROL_DEFAULT } from './StorageAdapter'

/******************* CLOUDFLARE R2 STORAGE ADAPTER ***********************/

/**
 * Storage adapter implementation for Cloudflare R2.
 * R2 is S3-compatible, so we use the AWS SDK.
 *
 * Uses environment variables:
 * - R2_ACCOUNT_ID: Cloudflare account ID
 * - R2_ACCESS_KEY_ID: R2 API token access key ID
 * - R2_SECRET_ACCESS_KEY: R2 API token secret access key
 * - R2_BUCKET_NAME: The R2 bucket name
 * - R2_PUBLIC_URL: The public URL for the bucket (e.g., custom domain or r2.dev subdomain)
 */
export class CloudflareR2Adapter implements StorageAdapter {
  private client: S3Client | null = null
  private readonly accountId: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly bucketName: string
  private readonly publicUrl: string

  constructor() {
    this.accountId = process.env.R2_ACCOUNT_ID ?? ''
    this.accessKeyId = process.env.R2_ACCESS_KEY_ID ?? ''
    this.secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? ''
    this.bucketName = process.env.R2_BUCKET_NAME ?? ''
    this.publicUrl = process.env.R2_PUBLIC_URL ?? ''
  }

  /******************* HELPERS ***********************/

  private getClient(): S3Client {
    if (!this.client) {
      if (!this.isConfigured()) {
        throw new Error(
          'CloudflareR2Adapter: Missing required env vars (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL)',
        )
      }
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      })
    }
    return this.client
  }

  /******************* INTERFACE IMPLEMENTATION ***********************/

  isConfigured(): boolean {
    return Boolean(
      this.accountId &&
      this.accessKeyId &&
      this.secretAccessKey &&
      this.bucketName &&
      this.publicUrl,
    )
  }

  async upload(buffer: Buffer | ArrayBuffer, path: string, options: UploadOptions): Promise<void> {
    const client = this.getClient()

    // Convert ArrayBuffer to Buffer if needed
    // Use Uint8Array view for proper ArrayBuffer to Buffer conversion
    const body = buffer instanceof Buffer ? buffer : Buffer.from(new Uint8Array(buffer))

    const params: PutObjectCommandInput = {
      Bucket: this.bucketName,
      Key: path,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl ?? CACHE_CONTROL_DEFAULT,
    }

    const command = new PutObjectCommand(params)
    await client.send(command)
  }

  getPublicUrl(path: string): string {
    // Remove trailing slash from publicUrl if present, then append path
    const baseUrl = this.publicUrl.replace(/\/$/, '')
    return `${baseUrl}/${path}`
  }

  async delete(path: string): Promise<void> {
    const client = this.getClient()

    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: path,
    })

    await client.send(command)
  }
}
