import { XMLParser } from 'fast-xml-parser'

/******************* TYPES ***********************/

export type RssSource = 'berliner-zeitung' | 'nytimes'

export interface RssTopic {
  source: RssSource
  title: string
  url: string
  publishedAt?: string
}

export interface FetchRssTopicsResult {
  topics: RssTopic[]
  topicSummary: string
}

/******************* CONSTANTS ***********************/

const DEFAULT_REVALIDATE_SECONDS = 3600
const DEFAULT_MAX_ITEMS_PER_SOURCE = 12

const DEFAULT_FEEDS: Record<RssSource, string[]> = {
  // Berliner Zeitung: provide via env (RSS_BERLINER_ZEITUNG_FEED).
  'berliner-zeitung': [],
  'nytimes': ['https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml'],
}

/******************* HELPERS ***********************/

function normalizeRssItems(args: {
  source: RssSource
  xml: string
  maxItems: number
}): RssTopic[] {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && Array.isArray(value) === false

  const asArray = <T,>(value: T | T[] | undefined | null): T[] => {
    if (Array.isArray(value)) return value
    if (value === undefined || value === null) return []
    return [value]
  }

  const toStringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '')

  const getStringProp = (obj: unknown, key: string): string => {
    if (!isRecord(obj)) return ''
    return toStringOrEmpty(obj[key])
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // RSS/Atom can include entities / CDATA; this is usually sufficient.
    processEntities: true,
  })

  const doc = parser.parse(args.xml) as unknown
  if (!isRecord(doc)) return []

  // RSS 2.0 shape: rss.channel.item[]
  const rss = doc.rss
  const channel = isRecord(rss) ? rss.channel : undefined
  const rssItemsRaw = asArray<unknown>(isRecord(channel) ? channel.item : undefined)
  if (rssItemsRaw.length > 0) {
    return rssItemsRaw
      .map((item) => {
        const title = getStringProp(item, 'title').trim()
        const url = getStringProp(item, 'link').trim()
        const publishedAtRaw = getStringProp(item, 'pubDate').trim()

        return {
          source: args.source,
          title,
          url,
          publishedAt: publishedAtRaw.length > 0 ? publishedAtRaw : undefined,
        }
      })
      .filter((t) => t.title.length > 0 && t.url.length > 0)
      .slice(0, args.maxItems)
  }

  // Atom shape: feed.entry[]
  const feed = doc.feed
  const atomEntriesRaw = asArray<unknown>(isRecord(feed) ? feed.entry : undefined)
  if (atomEntriesRaw.length > 0) {
    return atomEntriesRaw
      .map((entry) => {
        const title = getStringProp(entry, 'title').trim()

        let url = ''
        if (isRecord(entry)) {
          const link = entry.link
          const firstLink = asArray<unknown>(link)[0]
          if (isRecord(firstLink)) {
            url = toStringOrEmpty(firstLink['@_href']).trim()
          } else if (typeof firstLink === 'string') {
            url = firstLink.trim()
          }
        }

        const updated = getStringProp(entry, 'updated').trim()
        const published = getStringProp(entry, 'published').trim()

        return {
          source: args.source,
          title,
          url,
          publishedAt: updated.length > 0 ? updated : published.length > 0 ? published : undefined,
        }
      })
      .filter((t) => t.title.length > 0 && t.url.length > 0)
      .slice(0, args.maxItems)
  }

  return []
}

async function fetchText(url: string, revalidateSeconds: number): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // Some publishers block default node user-agents.
      'user-agent': 'theweddingtimesberlin/1.0 (+https://vercel.com)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    next: { revalidate: revalidateSeconds },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }

  return await res.text()
}

function buildTopicSummary(topics: RssTopic[]): string {
  if (topics.length === 0) return ''
  const lines = topics.map((t) => `- [${t.source}] ${t.title}`)
  return lines.join('\n')
}

/******************* MAIN ***********************/

export async function fetchRssTopics(args?: {
  revalidateSeconds?: number
  maxItemsPerSource?: number
}): Promise<FetchRssTopicsResult> {
  const revalidateSeconds = args?.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS
  const maxItemsPerSource = args?.maxItemsPerSource ?? DEFAULT_MAX_ITEMS_PER_SOURCE

  const topics: RssTopic[] = []

  const berlinerFeedOverride = process.env.RSS_BERLINER_ZEITUNG_FEED

  const berlinerFeedCandidates: string[] = []
  if (berlinerFeedOverride) berlinerFeedCandidates.push(berlinerFeedOverride)

  berlinerFeedCandidates.push(...DEFAULT_FEEDS['berliner-zeitung'])

  // NYTimes: fixed default RSS, but allow override
  const nytimesFeedCandidates = [
    ...(process.env.RSS_NYTIMES_FEED ? [process.env.RSS_NYTIMES_FEED] : []),
    ...DEFAULT_FEEDS.nytimes,
  ]

  const sources: Array<{ source: RssSource; candidates: string[] }> = [
    { source: 'berliner-zeitung', candidates: berlinerFeedCandidates },
    { source: 'nytimes', candidates: nytimesFeedCandidates },
  ]

  for (const s of sources) {
    let xml: string | null = null
    for (const url of s.candidates) {
      try {
        xml = await fetchText(url, revalidateSeconds)
        break
      } catch {
        continue
      }
    }

    if (!xml) continue

    const parsed = normalizeRssItems({ source: s.source, xml, maxItems: maxItemsPerSource })
    topics.push(...parsed)
  }

  return {
    topics,
    topicSummary: buildTopicSummary(topics),
  }
}

