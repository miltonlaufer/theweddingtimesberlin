import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOrComputeBlacklistSummary } from './blacklistSummaryCache'

describe('blacklist summary pruning', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
  })

  it('does not prune Instagram integration state', async () => {
    process.env = {
      ...originalEnv,
      BLACKLIST_SUMMARY_CACHE_PRUNE_CHANCE: '1',
    }
    const deletedIds: Array<string | number> = []
    const expiredDocs = [
      {
        id: 1,
        cacheType: 'blacklist-summary',
        cacheKey: 'instagram-token-state:v1',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 2,
        cacheType: 'blacklist-summary',
        cacheKey: 'blacklist-summary:v1:old',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ]
    const payload = {
      find: vi.fn(async ({ where }: { where?: { cacheType?: unknown; cacheKey?: unknown } }) => ({
        docs: where?.cacheType ? expiredDocs : [],
      })),
      delete: vi.fn(async ({ id }: { id: string | number }) => {
        deletedIds.push(id)
      }),
      create: vi.fn().mockResolvedValue({ id: 3 }),
      update: vi.fn(),
    }

    await getOrComputeBlacklistSummary({
      payload: payload as never,
      titles: ['A new headline'],
      computeSummary: async () => 'A new summary',
    })

    expect(deletedIds).toEqual([2])
  })
})
