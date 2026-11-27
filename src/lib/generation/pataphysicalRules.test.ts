import { afterEach, expect, it, vi } from 'vitest'
import { assignPataphysicalRules } from './pataphysicalRules'

afterEach(() => vi.restoreAllMocks())
it('assigns one or two literal-claim rules to six slots', () => {
  for (const roll of [0.1, 0.9]) {
    vi.spyOn(Math, 'random').mockReturnValue(roll)
    const rules = assignPataphysicalRules(6)
    expect(rules.filter((rule) => rule.includes('rule: literal claim'))).toHaveLength(
      roll < 0.5 ? 2 : 1,
    )
    expect(rules).toHaveLength(6)
    vi.restoreAllMocks()
  }
})
it('handles an empty batch', () => {
  expect(assignPataphysicalRules(0)).toEqual([])
})
