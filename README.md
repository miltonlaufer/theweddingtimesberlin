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

Satirical news site built with **Next.js (App Router)** + **Payload CMS**.

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
```

### Environment variables (LLM)

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional; defaults to `gpt-4o-mini`)
- `OPENAI_IMAGE_MODEL` (optional; defaults to `gpt-image-1`)
- `OPENAI_REPAIR_MODEL` (optional; fallback model for JSON repair)
- `OPENAI_AUTHOR_MODEL` (optional; model for generating fictional authors)

### Optional RSS overrides

- `RSS_BERLINER_ZEITUNG_FEED` (explicit RSS URL)
- `RSS_NYTIMES_FEED` (optional override; default: NYT HomePage RSS)

## Images (Supabase Storage)

Generated images are uploaded to **Supabase Storage**, and only the resulting URL is stored in Payload.

- `SUPABASE_URL` (required)
- `SUPABASE_SERVICE_ROLE_KEY` (required)
- `SUPABASE_BUCKET` (required)

## Hourly Updates (Vercel Cron)

The site uses **Next.js ISR** (revalidate every hour) combined with **Vercel Cron** to auto-generate new articles.

### Cron endpoint

- `GET /api/cron/generate` — protected by `CRON_SECRET` in production

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

### Author Pool

The system auto-generates fictional authors when the pool is too small:

- `MIN_AUTHOR_POOL` (default: 8)
- `MAX_NEW_AUTHORS_PER_RUN` (default: 3)
