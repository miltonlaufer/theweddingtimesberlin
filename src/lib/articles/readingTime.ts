export function calculateReadingTime(content: string): number {
  const text = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const wordCount = text.split(' ').filter((w) => w.length > 0).length
  return Math.max(1, Math.ceil(wordCount / 200))
}
