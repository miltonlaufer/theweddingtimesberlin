import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateAndUploadImage } from '@/lib/images/generateAndUploadImage'

/******************* CONSTANTS ***********************/

const LOG_ENDPOINT =
  'http://127.0.0.1:7242/ingest/d53ebca8-76d4-4cc1-bbe5-1222d559c59c'

function log(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'supabase-smoke',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion agent log
}

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

  log('A', 'src/app/(payload)/api/debug/supabase/route.ts:44', 'env_presence', {
    hasSupabaseUrl: supabaseUrl.length > 0,
    hasServiceRoleKey: supabaseServiceRole.length > 0,
    hasBucket: bucket.length > 0,
    debugUploadEnv,
    forceUpload,
  })

  if (!supabaseUrl || !supabaseServiceRole || !bucket) {
    log('A', 'src/app/(payload)/api/debug/supabase/route.ts:46', 'missing_env', {
      supabaseUrlLen: supabaseUrl.length,
      serviceRoleKeyLen: supabaseServiceRole.length,
      bucketLen: bucket.length,
    })
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

  log('D', 'src/app/(payload)/api/debug/supabase/route.ts:68', 'client_created', {
    supabaseUrlHost: (() => {
      try {
        return new URL(supabaseUrl).host
      } catch {
        return 'invalid-url'
      }
    })(),
  })

  const result: Record<string, unknown> = {
    ok: true,
    bucket,
    checks: {},
  }

  try {
    // Check 1: list buckets (permission-sensitive)
    const bucketsRes = await client.storage.listBuckets()
    log('C', 'src/app/(payload)/api/debug/supabase/route.ts:87', 'listBuckets_result', {
      hasError: Boolean(bucketsRes.error),
      errorCode: bucketsRes.error?.name ?? null,
      bucketCount: bucketsRes.data?.length ?? null,
    })

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
    log('B', 'src/app/(payload)/api/debug/supabase/route.ts:105', 'bucket_list_result', {
      hasError: Boolean(listRes.error),
      errorCode: listRes.error?.name ?? null,
      returnedCount: listRes.data?.length ?? null,
    })

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
    log('A', 'src/app/(payload)/api/debug/supabase/route.ts:147', 'upload_branch', {
      doUpload,
      debugUploadEnv,
      forceUpload,
    })
    if (doUpload) {
      const uploaded = await generateAndUploadImage({
        prompt: 'A photo-like satirical newspaper illustration of Berlin Wedding, wide street scene, no text',
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
    log('D', 'src/app/(payload)/api/debug/supabase/route.ts:126', 'exception', { message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  log('A', 'src/app/(payload)/api/debug/supabase/route.ts:132', 'success_response', {
    ok: true,
  })
  return NextResponse.json(result)
}

