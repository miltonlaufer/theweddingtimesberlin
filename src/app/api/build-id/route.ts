import { readFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'

/******************* HANDLER ***********************/

export async function GET() {
  let buildId = ''

  try {
    const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID')
    buildId = (await readFile(buildIdPath, 'utf8')).trim()
  } catch {
    // Build ID isn't available yet (dev) or not readable; return empty string.
  }

  return NextResponse.json(
    { buildId },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
