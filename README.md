## The Wedding Times Berlin

Satirical news site built with **Next.js (App Router)** + **Payload CMS**.

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
- `OPENAI_IMAGE_MODEL` (optional; defaults to `dall-e-3`)
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

## Commands

```bash
npx tsc --noEmit
npm run lint
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
