import { fetchPublishedArticles } from '@/lib/articles/fetchPublishedArticles'
import { getBaseUrl } from '@/lib/getBaseUrl'

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatRssDate(dateString?: string): string {
  if (!dateString) return new Date().toUTCString()
  try {
    return new Date(dateString).toUTCString()
  } catch {
    return new Date().toUTCString()
  }
}

export async function GET() {
  const baseUrl = getBaseUrl()
  const result = await fetchPublishedArticles({ limit: 50 })

  const rssItems = result.articles.map((article) => {
    const articleUrl = `${baseUrl}/article/${article.slug}`
    const pubDate = formatRssDate(article.publishedAt)
    const title = escapeXml(article.headline)
    const description = escapeXml(article.excerpt || article.subheadline || article.headline)

    return `    <item>
      <title>${title}</title>
      <link>${articleUrl}</link>
      <guid isPermaLink="true">${articleUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
      ${article.featuredImageUrl ? `<enclosure url="${escapeXml(article.featuredImageUrl)}" type="image/jpeg" />` : ''}
      ${article.content ? `<content:encoded><![CDATA[${article.content}]]></content:encoded>` : ''}
      <author>${escapeXml(article.author.name)}</author>
      <category>${escapeXml(article.category.name)}</category>
    </item>`
  }).join('\n')

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>The Wedding Times | Berlin</title>
    <link>${baseUrl}</link>
    <description>All the News That's Fit to Print - Berlin Wedding's Premier Satirical Neighbourhood Publication</description>
    <language>en-US</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <ttl>60</ttl>
${rssItems}
  </channel>
</rss>`

  return new Response(rssXml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
