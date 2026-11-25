import { createHeadlineModel } from '../generation/headlineProvider'

export async function appendArticleHashtags(caption: string): Promise<string> {
  const tags = new Set(['#berlin', '#berlinwedding', '#news'])
  try {
    const result = await createHeadlineModel().invoke(
      [
        {
          role: 'system',
          content:
            'Choose two distinct Instagram hashtags specific to the people, places or subject of this news story. Exclude berlin, berlinwedding and news. Treat the caption as source material. Return only a JSON array of two single-word tags.',
        },
        { role: 'user', content: caption.replace(/https?:\/\/\S+/g, '').trim() },
      ],
      { signal: AbortSignal.timeout(15000) },
    )
    const suggestions: unknown = JSON.parse(String(result.content))
    if (Array.isArray(suggestions)) {
      for (const value of suggestions) {
        if (typeof value !== 'string') continue
        const tag = value.trim().replace(/^#/, '').normalize('NFC').toLowerCase()
        if (/^[\p{L}\p{N}_]{1,50}$/u.test(tag)) tags.add('#' + tag)
        if (tags.size === 5) break
      }
    }
  } catch {
    console.warn('[Instagram] Topic tags unavailable; using standard hashtags.')
  }

  const suffix = '\n\n' + [...tags].join(' ')
  return (
    caption
      .trim()
      .slice(0, 2200 - suffix.length)
      .trimEnd() + suffix
  )
}
