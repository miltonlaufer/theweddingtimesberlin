import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRssTopics } from './fetchRssTopics'

describe('fetchRssTopics source context', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  it('preserves a readable RSS description alongside the title, URL, and publication date', async () => {
    process.env = {
      ...originalEnv,
      RSS_NYTIMES_FEED: 'https://feeds.example.test/current.xml',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            [
              '<rss><channel><item>',
              '<title>Chancellor Faces Calls to Resign</title>',
              '<link>https://news.example.test/chancellor</link>',
              '<pubDate>Mon, 21 Sep 2026 06:00:00 GMT</pubDate>',
              '<description><![CDATA[<p>Friedrich Merz faces coalition pressure after the vote.</p>]]></description>',
              '</item></channel></rss>',
            ].join(''),
            { status: 200, headers: { 'content-type': 'application/rss+xml' } },
          ),
      ),
    )

    const result = await fetchRssTopics({ maxItemsPerSource: 1 })

    expect(result.topics[0]).toMatchObject({
      title: 'Chancellor Faces Calls to Resign',
      url: 'https://news.example.test/chancellor',
      publishedAt: 'Mon, 21 Sep 2026 06:00:00 GMT',
      description: 'Friedrich Merz faces coalition pressure after the vote.',
    })
  })
})
