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

  it('trims long fallback summaries at a clause instead of a dangling phrase', () => {
    const html =
      '<p>A Kreuzberg wellness collective that made its money selling discipline, breathwork, and the kind of self-control usually reserved for hedge funds and abandoned marriages has rebranded itself as a trauma embassy, complete with intake forms, donation tiers, and a waiting list long enough to be mistaken for civic demand.</p>'

    expect(buildSummaryFromHtmlContent(html, 300)).toBe(
      'A Kreuzberg wellness collective that made its money selling discipline, breathwork, and the kind of self-control usually reserved for hedge funds and abandoned marriages has rebranded itself as a trauma embassy, complete with intake forms, donation tiers.',
    )
  })
})
