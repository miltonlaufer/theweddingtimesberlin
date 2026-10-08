import { afterEach, describe, expect, it, vi } from 'vitest'
import { rewriteOverlongSummaries } from './rewriteOverlongSummaries'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(() => ({ invoke: mocks.invoke })),
}))

const longSubheadline =
  'Union Berlin’s standing-room devotion is about to be treated like a scheduling miracle, as Bundesliga bosses discover that the club’s biggest asset is not football but the crowd’s willingness to rearrange its entire schedule.'

describe('rewriteOverlongSummaries', () => {
  afterEach(() => mocks.invoke.mockReset())

  it('rewrites an overlong subheadline without changing other article fields', async () => {
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        subheadline:
          'Bundesliga bosses prize Union Berlin supporters for rearranging their lives around television schedules.',
      }),
    })
    const result = await rewriteOverlongSummaries({
      headline: 'Champions of Prime Time Beg for Monday Night',
      subheadline: longSubheadline,
      excerpt: 'The league wants Monday matches.',
      bodyMarkdown: 'The original body stays intact.',
    })

    expect(result).toEqual({
      headline: 'Champions of Prime Time Beg for Monday Night',
      subheadline:
        'Bundesliga bosses prize Union Berlin supporters for rearranging their lives around television schedules.',
      excerpt: 'The league wants Monday matches.',
      bodyMarkdown: 'The original body stays intact.',
    })
    expect(JSON.stringify(mocks.invoke.mock.calls[0][0])).toContain(longSubheadline)
  })

  it('keeps compliant text without another model call', async () => {
    const article = { subheadline: 'The league wants Monday matches.', excerpt: null }
    expect(await rewriteOverlongSummaries(article)).toEqual(article)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('rewrites a long excerpt as well as a long subheadline', async () => {
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({
        subheadline: 'Fans change their plans.',
        excerpt: 'Television controls the fixture list.',
      }),
    })
    const result = await rewriteOverlongSummaries({
      subheadline: longSubheadline,
      excerpt:
        'Television executives insist that supporters organize every evening around the fixture list, '.repeat(
          4,
        ),
    })
    expect(result).toEqual({
      subheadline: 'Fans change their plans.',
      excerpt: 'Television controls the fixture list.',
    })
  })

  it('retries an overlong rewrite instead of clipping it', async () => {
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({ subheadline: longSubheadline }),
    })
    mocks.invoke.mockResolvedValueOnce({
      content: JSON.stringify({ subheadline: 'Fans rearrange their lives for television.' }),
    })
    expect(await rewriteOverlongSummaries({ subheadline: longSubheadline })).toEqual({
      subheadline: 'Fans rearrange their lives for television.',
    })
  })

  it.each([null, '', 'Fans rearrange their entire...', 'Fans change their plans'])(
    'fails rather than dropping the field when the rewrite remains invalid: %s',
    async (subheadline) => {
      mocks.invoke.mockResolvedValue({ content: JSON.stringify({ subheadline }) })
      await expect(rewriteOverlongSummaries({ subheadline: longSubheadline })).rejects.toThrow(
        'Could not rewrite supporting text within its limits',
      )
    },
  )
})
