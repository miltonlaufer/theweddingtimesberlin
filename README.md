## The Wedding Times

[![CI](https://github.com/miltonlaufer/theweddingtimesberlin/actions/workflows/ci.yml/badge.svg)](https://github.com/miltonlaufer/theweddingtimesberlin/actions/workflows/ci.yml)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?logo=vercel&logoColor=white)](https://theweddingtimesberlin.de/)
[![Website](https://img.shields.io/badge/Website-Live-1f2937)](https://theweddingtimesberlin.de/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Payload](https://img.shields.io/badge/Payload-CMS-1a1a1a?logo=payloadcms&logoColor=white)](https://payloadcms.com/)
[![Vitest](https://img.shields.io/badge/Vitest-Unit%20Tests-6e9f18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2e2e2e?logo=playwright&logoColor=white)](https://playwright.dev/)
[![ESLint](https://img.shields.io/badge/ESLint-9-4B32C3?logo=eslint&logoColor=white)](https://eslint.org/)

Satirical news site built with **Next.js (App Router)** + **Payload CMS**. Features include AI-generated articles, push notifications, offline support, and a PWA experience.

Live site: https://theweddingtimesberlin.de/

![Homepage layout](public/layout.png)

## Getting Started

Install dependencies:

```bash
npm install
```

Run the dev server (configured to use port **3050**):

```bash
npm run dev
```

Open `http://localhost:3050` in your browser.

## Scripts

```bash
npm run dev         # start Next dev server on :3050
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run test        # vitest (unit/integration)
npm run test:e2e    # playwright (e2e)
npm run format      # prettier write
npm run format:check
npm run ci          # lint + typecheck + test + test:e2e
```

## Tooling

- **ESLint** for linting
- **Prettier** for formatting
- **Husky + lint-staged** for pre-commit checks
- **Vitest** for unit/integration tests
- **Playwright** for end-to-end tests

## Payload CMS / Database

Payload is configured to use:

- **SQLite locally** (default) using `file:./payload.db`
- **Postgres when `DATABASE_URI` starts with `postgres`** (recommended for Vercel / Supabase)

### Environment variables

Minimum:

- `PAYLOAD_SECRET` (required)
- `DATABASE_URI` (optional locally; required for Postgres)
- `RESEND_API_KEY` (required for password reset emails)
- `RESEND_FROM_ADDRESS` (required; must be a verified sender in Resend)

Example local `.env.local` (SQLite):

```bash
PAYLOAD_SECRET="change-me"
```

Example `.env.local` (Supabase Postgres):

```bash
PAYLOAD_SECRET="change-me"
DATABASE_URI="postgres://USER:PASSWORD@HOST:5432/DBNAME"
RESEND_API_KEY="re_xxxxxxxxxxxxx"
RESEND_FROM_ADDRESS="admin@yourdomain.com"
```

## Email Configuration (Resend)

Payload CMS uses **Resend** for sending password reset emails and other transactional emails.

### Setup

1. Create a free account at [Resend](https://resend.com)
2. Get your API key from the [Resend dashboard](https://resend.com/api-keys)
3. Add and verify a sender domain/email address in the Resend dashboard
4. Set the following environment variables:
   - `RESEND_API_KEY` - Your Resend API key
   - `RESEND_FROM_ADDRESS` - A verified sender email address

**Note:** Resend offers a generous free tier (3,000 emails/month) which is perfect for development and small projects.

## RSS + LLM Article Generation

The site auto-generates satirical articles using:

- **RSS topics** fetched from NYT + Berliner Zeitung (hourly cache)
- **LangChain + OpenAI** for article text generation
- **DALL-E** for optional image generation (2/3 chance)
- **Supabase Storage** for image hosting

### Manual generation (local dev)

```bash
# Generate + publish an article
curl -X POST "http://localhost:3050/api/debug/generate-article"

# Dry run (returns JSON without saving)
curl -X POST "http://localhost:3050/api/debug/generate-article?publish=0"

# Save as draft (creates DB record with status=draft)
curl -X POST "http://localhost:3050/api/debug/generate-article?draft"
```

### Environment variables (LLM)

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional; defaults to `gpt-4o-mini`)
- `OPENAI_IMAGE_MODEL` (optional; defaults to `gpt-image-1`)
- `OPENAI_REPAIR_MODEL` (optional; fallback model for JSON repair)
- `OPENAI_AUTHOR_MODEL` (optional; model for generating fictional authors)
- `OPENAI_BRIEF_MODEL` (optional; satire-brief model, defaults to `OPENAI_MODEL`)
- `OPENAI_CRITIC_MODEL` (optional; critique scorer model)
- `OPENAI_REWRITE_MODEL` (optional; critique rewrite model, defaults to `OPENAI_MODEL`)
- `OPENAI_TRANSLATE_MODEL` (optional; translation model, defaults to `OPENAI_REPAIR_MODEL`)
- `OPENAI_TONE_PROFILE` (optional; `balanced` | `acidic` | `merciless`, default: `acidic`)
- `SATIRE_MIN_CRITIQUE_SCORE` (optional; 1-10 threshold for rewrite pass, default: `7`)
- `BLACKLIST_SUMMARY_CACHE_TTL_HOURS` (optional; DB cache TTL for blacklist summaries, default: `24`)
- `BLACKLIST_SUMMARY_CACHE_PRUNE_CHANCE` (optional; cleanup probability per cache read, default: `0.2`)
- `BLACKLIST_SUMMARY_CACHE_PRUNE_SCAN_LIMIT` (optional; max rows scanned per cleanup run, default: `200`)

### Optional RSS overrides

- `RSS_BERLINER_ZEITUNG_FEED` (explicit RSS URL)
- `RSS_NYTIMES_FEED` (optional override; default: NYT HomePage RSS)

## Image Storage

Generated images are uploaded to cloud storage, converted to WebP format for optimal file size, and the resulting URL is stored in Payload.

### Features

- **Dual format upload**: Both PNG (original) and WebP (optimized) are uploaded
- **WebP by default**: Articles store the WebP URL for ~30% smaller file sizes
- **Aggressive caching**: Images are served with `Cache-Control: public, max-age=31536000, immutable` (1 year)
- **Provider flexibility**: Supports Supabase Storage or Cloudflare R2

### Storage Providers

#### Supabase Storage (default)

```bash
STORAGE_PROVIDER="supabase"  # or omit (supabase is default)
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
SUPABASE_BUCKET="images"
```

#### Cloudflare R2 (recommended for high traffic)

Cloudflare R2 has **zero egress fees**, making it ideal for image-heavy sites.

```bash
STORAGE_PROVIDER="cloudflare"
R2_ACCOUNT_ID="your-account-id"
R2_ACCESS_KEY_ID="your-access-key-id"
R2_SECRET_ACCESS_KEY="your-secret-access-key"
R2_BUCKET_NAME="images"
R2_PUBLIC_URL="https://images.yourdomain.com"  # or https://pub-xxx.r2.dev
```

### Optional: Image Proxy

To hide bucket URLs from end users, enable the image proxy:

```bash
IMAGE_PROXY_ENABLED="true"
```

Images can then be served through `/api/images/...` instead of direct bucket URLs. This routes traffic through Vercel, so it's best used with Cloudflare R2 (free egress) to avoid double-billing.

### Migration from Supabase to R2

1. Create an R2 bucket in Cloudflare dashboard
2. Configure CORS to allow your domain
3. Create an R2 API token with read/write permissions
4. Set the R2 environment variables
5. Change `STORAGE_PROVIDER=cloudflare`
6. New articles will use R2; existing articles continue working from Supabase

## Hourly Updates (Vercel Cron)

The site uses **Next.js ISR** (revalidate every hour) combined with **Vercel Cron** to auto-generate new articles.

### Cron endpoint

- `GET /api/cron/generate` — protected by `CRON_SECRET` in production
  - Generates new articles based on RSS topics
  - Automatically sends push notifications to subscribed users after successful article generation

### Environment variables

- `CRON_SECRET` (required for production)

### Vercel Cron Configuration

The `vercel.json` includes:

```json
{
  "crons": [
    {
      "path": "/api/cron/generate",
      "schedule": "0 * * * *"
    }
  ]
}
```

**Note:** Vercel Hobby (free) accounts are limited to **daily** cron frequency. For hourly updates, you need a **Pro** account or can use an external service (e.g., cron-job.org) to hit the endpoint.

#### Author Pool

The system auto-generates fictional authors when the pool is too small:

- `MIN_AUTHOR_POOL` (default: 8)
- `MAX_NEW_AUTHORS_PER_RUN` (default: 3)

## Progressive Web App (PWA)

The site is a **Progressive Web App** with offline support and push notifications.

### Features

- **Service Worker** for offline functionality and caching
- **Push Notifications** to alert users when new articles are published
- **Installable** - users can add the site to their home screen
- **Offline page** - shows a custom offline page when the network is unavailable

### Push Notifications

Users can subscribe to receive push notifications when new articles are published. Notifications are automatically sent after each cron job run.

#### Setup

1. Generate VAPID keys:

   ```bash
   npx web-push generate-vapid-keys
   ```

2. Add to your `.env.local`:

   ```bash
   VAPID_PUBLIC_KEY="your-public-key-here"
   VAPID_PRIVATE_KEY="your-private-key-here"
   VAPID_EMAIL="mailto:admin@example.com"
   ```

3. Add the `PushNotificationButton` component to your UI (e.g., in the Footer):

   ```tsx
   import { PushNotificationButton } from '@/components/PushNotificationButton'
   ;<PushNotificationButton />
   ```

#### How It Works

1. Users click "Enable Push Notifications" → browser requests permission
2. If granted, subscription is saved to the database (`push-subscriptions` collection)
3. When the cron job runs and creates articles, notifications are automatically sent to all subscribers
4. Users receive notifications and can click to open the latest article

#### API Endpoints

- `GET /api/push/vapid-public-key` - Returns the VAPID public key for client-side subscription
- `POST /api/push/subscribe` - Registers a user's push subscription

#### Service Worker

The service worker (`src/sw.ts`) handles:

- Push event notifications
- Notification click events (opens the article URL)
- Offline page caching
- Article page caching for faster navigation

## Environment Variables Summary

### Required

- `PAYLOAD_SECRET` - Payload CMS secret key
- `OPENAI_API_KEY` - OpenAI API key for article generation
- `RESEND_API_KEY` - Resend API key for emails
- `RESEND_FROM_ADDRESS` - Verified sender email address
- `CRON_SECRET` - Secret for protecting cron endpoints (production)

### Storage (one provider required)

**Supabase Storage** (default):

- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `SUPABASE_BUCKET` - Supabase storage bucket name

**Cloudflare R2** (if `STORAGE_PROVIDER=cloudflare`):

- `R2_ACCOUNT_ID` - Cloudflare account ID
- `R2_ACCESS_KEY_ID` - R2 API token access key
- `R2_SECRET_ACCESS_KEY` - R2 API token secret
- `R2_BUCKET_NAME` - R2 bucket name
- `R2_PUBLIC_URL` - Public URL for R2 bucket

### Optional

- `DATABASE_URI` - Database connection string (defaults to SQLite locally)
- `STORAGE_PROVIDER` - Storage provider: `supabase` (default) or `cloudflare`
- `IMAGE_PROXY_ENABLED` - Enable image proxy to hide bucket URLs (default: `false`)
- `OPENAI_MODEL` - OpenAI model (default: `gpt-4o-mini`)
- `OPENAI_IMAGE_MODEL` - Image generation model (default: `gpt-image-1.5`)
- `OPENAI_REPAIR_MODEL` - JSON repair fallback model
- `OPENAI_AUTHOR_MODEL` - Author generation model
- `OPENAI_BRIEF_MODEL` - Satire brief model (default: `OPENAI_MODEL`)
- `OPENAI_CRITIC_MODEL` - Satire critique model
- `OPENAI_REWRITE_MODEL` - Critique rewrite model (default: `OPENAI_MODEL`)
- `OPENAI_TRANSLATE_MODEL` - Translation model (default: `OPENAI_REPAIR_MODEL`)
- `OPENAI_TONE_PROFILE` - Satire tone profile: `balanced`, `acidic`, or `merciless`
- `SATIRE_MIN_CRITIQUE_SCORE` - Minimum critique score to skip rewrite (default: `7`)
- `BLACKLIST_SUMMARY_CACHE_TTL_HOURS` - DB cache TTL (hours) for blacklist summaries (default: `24`)
- `BLACKLIST_SUMMARY_CACHE_PRUNE_CHANCE` - Expired-cache cleanup probability per read (default: `0.2`)
- `BLACKLIST_SUMMARY_CACHE_PRUNE_SCAN_LIMIT` - Max cache rows scanned per cleanup run (default: `200`)
- `RSS_BERLINER_ZEITUNG_FEED` - Berliner Zeitung RSS feed URL
- `RSS_NYTIMES_FEED` - NYT RSS feed override
- `ARTICLES_PER_RUN` - Articles to generate per cron run (default: 8, can be overridden via env var)
- `MIN_AUTHOR_POOL` - Minimum author count (default: 8)
- `MAX_NEW_AUTHORS_PER_RUN` - Max new authors per run (default: 3)
- `VAPID_PUBLIC_KEY` - Push notification public key
- `VAPID_PRIVATE_KEY` - Push notification private key
- `VAPID_EMAIL` - VAPID email (default: `mailto:admin@example.com`)

See `ENV.example` for a complete template.
