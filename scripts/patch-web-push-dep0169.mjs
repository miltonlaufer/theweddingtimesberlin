import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const targetPath = path.join(process.cwd(), 'node_modules', 'web-push', 'src', 'web-push-lib.js')

async function patchWebPush() {
  let source
  try {
    source = await fs.readFile(targetPath, 'utf8')
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') {
      console.log('[patch-web-push-dep0169] web-push source not found, skipping patch')
      return
    }
    throw error
  }

  if (source.includes('PATCH: dep0169-url-parse')) {
    console.log('[patch-web-push-dep0169] patch already applied')
    return
  }

  const firstNeedle =
    "      const parsedUrl = url.parse(subscription.endpoint);\n      const audience = parsedUrl.protocol + '//'\n      + parsedUrl.host;"
  const firstReplacement =
    "      const parsedUrl = new URL(subscription.endpoint);\n      const audience = parsedUrl.origin; // PATCH: dep0169-url-parse"

  const secondNeedle =
    '      const urlParts = url.parse(requestDetails.endpoint);\n' +
    '      httpsOptions.hostname = urlParts.hostname;\n' +
    '      httpsOptions.port = urlParts.port;\n' +
    '      httpsOptions.path = urlParts.path;'
  const secondReplacement =
    '      const endpointUrl = new URL(requestDetails.endpoint); // PATCH: dep0169-url-parse\n' +
    '      httpsOptions.hostname = endpointUrl.hostname;\n' +
    '      httpsOptions.port = endpointUrl.port || undefined;\n' +
    '      httpsOptions.path = endpointUrl.pathname + endpointUrl.search;'

  if (!source.includes(firstNeedle) || !source.includes(secondNeedle)) {
    console.warn(
      '[patch-web-push-dep0169] expected web-push source pattern was not found; upstream file may have changed',
    )
    return
  }

  source = source.replace(firstNeedle, firstReplacement).replace(secondNeedle, secondReplacement)
  await fs.writeFile(targetPath, source, 'utf8')
  console.log('[patch-web-push-dep0169] patched web-push to avoid Node DEP0169 url.parse warnings')
}

await patchWebPush()
