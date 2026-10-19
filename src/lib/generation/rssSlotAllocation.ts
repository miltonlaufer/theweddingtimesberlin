import type { RssTopic } from '@/lib/rss/fetchRssTopics'
import { planEditorialSlots } from './editorialPlanner'

function titleIdentity(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
}

function urlIdentity(url: string): string {
  try {
    const parsed = new URL(url.trim())
    parsed.hash = ''
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    parsed.searchParams.sort()
    // URL normalizes the host; path and query values can be case-sensitive.
    return parsed.toString()
  } catch {
    return url.trim().split('#')[0] ?? ''
  }
}

/** Keep one ranked representative per source, locking all aliases of recently used titles. */
export function deduplicateFreshRssTopics(
  topics: RssTopic[],
  forbiddenTitles = new Set<string>(),
): RssTopic[] {
  const parents = topics.map((_, index) => index)
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!
      index = parents[index]!
    }
    return index
  }
  const identityOwners = new Map<string, number>()
  topics.forEach((topic, index) => {
    const keys = [
      topic.url.trim() ? `url:${urlIdentity(topic.url)}` : '',
      titleIdentity(topic.title) ? `title:${titleIdentity(topic.title)}` : '',
    ]
    for (const key of keys.filter(Boolean)) {
      const owner = identityOwners.get(key)
      if (owner != null) parents[find(index)] = find(owner)
      else identityOwners.set(key, index)
    }
  })

  const forbidden = new Set(Array.from(forbiddenTitles, titleIdentity))
  const lockedGroups = new Set<number>()
  topics.forEach((topic, index) => {
    if (forbidden.has(titleIdentity(topic.title))) lockedGroups.add(find(index))
  })
  const includedGroups = new Set<number>()
  return topics.filter((_, index) => {
    const group = find(index)
    if (lockedGroups.has(group) || includedGroups.has(group)) return false
    includedGroups.add(group)
    return true
  })
}

/** Reserve disjoint candidate pools before workers run, including all later retry attempts. */
export function planEditorialSlotsWithRssAllocation(
  args: Omit<Parameters<typeof planEditorialSlots>[0], 'hasRssTopics'> & { rssTopics: RssTopic[] },
) {
  const { rssTopics, ...plannerArgs } = args
  const topics = deduplicateFreshRssTopics(rssTopics)
  let plan = planEditorialSlots({ ...plannerArgs, hasRssTopics: topics.length > 0 })
  let rssSlotCount = plan.slots.filter((slot) => slot.forceRss).length
  if (rssSlotCount > topics.length) {
    // Replan the remaining slots normally so the requested batch size and editorial mix survive.
    plan = planEditorialSlots({
      ...plannerArgs,
      hasRssTopics: topics.length > 0,
      forcedRssSlots: topics.length,
    })
    rssSlotCount = plan.slots.filter((slot) => slot.forceRss).length
  }
  const pools: RssTopic[][] = Array.from({ length: rssSlotCount }, () => [])
  if (rssSlotCount > 0) {
    topics.forEach((topic, index) => pools[index % rssSlotCount]!.push(topic))
  }
  let rssSlotIndex = 0
  return {
    ...plan,
    slots: plan.slots.map((slot) => {
      const assignedRssTopics = slot.forceRss ? pools[rssSlotIndex++]! : []
      return {
        ...slot,
        rssPoolIsExclusive: slot.forceRss === true,
        assignedRssTopics,
        assignedRssTopicSummary: assignedRssTopics
          .map((topic) => `- [${topic.source}] ${topic.title}`)
          .join('\n'),
      }
    }),
  }
}
