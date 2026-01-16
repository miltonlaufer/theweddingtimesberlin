import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateAndUploadImage } from '@/lib/images/generateAndUploadImage'

/******************* ROUTE ***********************/

export async function GET(req: Request) {
  // Hypotheses:
  // A: Env vars not present at runtime
  // B: Bucket name wrong / bucket missing
  // C: Key is not service_role / missing permissions
  // D: Network / endpoint issues reaching Supabase

  const supabaseUrl = process.env.SUPABASE_URL ?? ''
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const bucket = process.env.SUPABASE_BUCKET ?? ''
  const debugUploadEnv = process.env.DEBUG_SUPABASE_UPLOAD ?? '0'

  const requestUrl = new URL(req.url)
  const forceUpload = requestUrl.searchParams.get('upload') === '1'

  if (!supabaseUrl || !supabaseServiceRole || !bucket) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_BUCKET',
      },
      { status: 500 },
    )
  }

  const client = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result: Record<string, unknown> = {
    ok: true,
    bucket,
    checks: {},
  }

  try {
    // Check 1: list buckets (permission-sensitive)
    const bucketsRes = await client.storage.listBuckets()
    result.checks = {
      ...((result.checks as object) || {}),
      listBuckets: {
        ok: bucketsRes.error == null,
        bucketCount: bucketsRes.data?.length ?? null,
        error: bucketsRes.error?.message ?? null,
      },
    }

    // Check 2: list objects in the configured bucket root
    const listRes = await client.storage.from(bucket).list('', { limit: 1 })
    result.checks = {
      ...((result.checks as object) || {}),
      listFromBucket: {
        ok: listRes.error == null,
        returnedCount: listRes.data?.length ?? null,
        error: listRes.error?.message ?? null,
      },
    }

    // Check 3: generate + upload a tiny image (requires OPENAI_API_KEY)
    // Allow forcing without restarting the dev server:
    // - env: DEBUG_SUPABASE_UPLOAD=1
    // - or query: ?upload=1
    const doUpload = debugUploadEnv === '1' || forceUpload
    if (doUpload) {
      const uploaded = await generateAndUploadImage({
        prompt:
          'A photo-like satirical newspaper illustration of Berlin Wedding, wide street scene, no text',
        fileBaseName: 'debug-upload',
      })
      result.checks = {
        ...((result.checks as object) || {}),
        upload: {
          ok: true,
          objectPath: uploaded.objectPath,
          publicUrl: uploaded.publicUrl,
        },
      }
    } else {
      result.checks = {
        ...((result.checks as object) || {}),
        upload: {
          ok: false,
          skipped: true,
          reason: 'Set DEBUG_SUPABASE_UPLOAD=1 to test image generation + upload',
        },
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  return NextResponse.json(result)
}
