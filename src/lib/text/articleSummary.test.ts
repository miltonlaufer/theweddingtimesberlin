import { describe, expect, it } from 'vitest'
import { buildSummaryFromHtmlContent, buildSummaryFromMarkdownContent } from './articleSummary'

describe('articleSummary', () => {
  it('builds a clean summary from the first HTML paragraph', () => {
    const html =
      "<div><p>Wedding clerks turned a noon appointment window into the district's latest test of patience, paperwork, and civic humiliation.</p><p>More text follows.</p></div>"

    expect(buildSummaryFromHtmlContent(html, 300)).toBe(
      "Wedding clerks turned a noon appointment window into the district's latest test of patience, paperwork, and civic humiliation.",
    )
  })

  it('skips markdown headings and summarizes the first body paragraph', () => {
    const markdown = [
      '### The rainbow sticker did not improve the queue',
      '',
      "At Wedding's Job Center on Mullerstrasse, the monthly pride campaign arrived laminated, overmanaged, and unchanged where it mattered.",
    ].join('\n')

    expect(buildSummaryFromMarkdownContent(markdown, 300)).toBe(
      "At Wedding's Job Center on Mullerstrasse, the monthly pride campaign arrived laminated, overmanaged, and unchanged where it mattered.",
    )
  })

  it('rejects long fallback paragraphs with no complete sentence under the limit', () => {
    const html =
      '<p>A Kreuzberg wellness collective that made its money selling discipline, breathwork, and the kind of self-control usually reserved for hedge funds and abandoned marriages has rebranded itself as a trauma embassy, complete with intake forms, donation tiers, and a waiting list long enough to be mistaken for civic demand.</p>'

    expect(buildSummaryFromHtmlContent(html, 300)).toBeUndefined()
  })

  it('skips an overlong HTML paragraph and uses the next complete paragraph', () => {
    const html =
      '<p>Union Berlin’s standing-room devotion is about to be treated like a scheduling miracle, as Bundesliga bosses discover that the club’s biggest asset is not football but the crowd’s willingness to rearrange its entire schedule.</p><p>The league wants Monday matches.</p>'

    expect(buildSummaryFromHtmlContent(html, 220)).toBe('The league wants Monday matches.')
  })

  it('skips an overlong Markdown paragraph and uses the next complete paragraph', () => {
    const markdown =
      'Union Berlin’s standing-room devotion is about to be treated like a scheduling miracle, as Bundesliga bosses discover that the club’s biggest asset is not football but the crowd’s willingness to rearrange its entire schedule.\n\nThe league wants Monday matches.'

    expect(buildSummaryFromMarkdownContent(markdown, 220)).toBe('The league wants Monday matches.')
  })
})
