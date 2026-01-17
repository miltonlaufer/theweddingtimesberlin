import { buildConfig } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { resendAdapter } from '@payloadcms/email-resend'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Articles } from './collections/Articles'
import { Categories } from './collections/Categories'
import { Authors } from './collections/Authors'
import { Media } from './collections/Media'
import { Users } from './collections/Users'
import { PushSubscriptions } from './collections/PushSubscriptions'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Articles, Categories, Authors, Media, PushSubscriptions],
  editor: lexicalEditor(),
  email: resendAdapter({
    apiKey: process.env.RESEND_API_KEY!,
    defaultFromAddress: process.env.RESEND_FROM_ADDRESS!,
    defaultFromName: 'Wedding Times Berlin',
  }),
  secret: process.env.PAYLOAD_SECRET || 'your-super-secret-key-change-in-production',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: (() => {
    const databaseUri = process.env.DATABASE_URI
    const isPostgresUri = databaseUri?.startsWith('postgres') === true

    // Avoid breaking local dev if a remote Postgres URI is present but unreachable.
    // - Production: use Postgres automatically
    // - Dev: use SQLite unless explicitly opted-in via PAYLOAD_USE_POSTGRES=1
    const usePostgres =
      isPostgresUri &&
      (process.env.NODE_ENV === 'production' || process.env.PAYLOAD_USE_POSTGRES === '1')

    return usePostgres
      ? postgresAdapter({
          migrationDir: path.resolve(dirname, 'migrations'),
          pool: {
            connectionString: databaseUri,
          },
        })
      : sqliteAdapter({
          client: {
            url: databaseUri?.startsWith('file:') === true ? databaseUri : 'file:./payload.db',
          },
        })
  })(),
  sharp,
})
