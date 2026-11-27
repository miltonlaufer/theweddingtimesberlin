const RELATIONSHIP_RULE =
  'Assigned pataphysical rule: relationship. Find what one party needs the other to do. Give that relationship one impossible property. Write the moment somebody has to act on it.'
const LITERAL_CLAIM_RULE =
  'Assigned pataphysical rule: literal claim. Privately find what an institution claims about itself. Make that claim physically true in one impossible way and follow whoever bears the cost. Report visible effects directly, keeping the rule implicit. Keep the claim recognizable through the action. Never label it fictional or explain the joke. Avoid invented quotations attributed to real people.'

/** Stochastic rounding gives 25% literal-claim slots over batches, then shuffles positions. */
export function assignPataphysicalRules(count: number): string[] {
  const target = count * 0.25
  const literalCount = Math.floor(target) + (Math.random() < target % 1 ? 1 : 0)
  const rules: string[] = Array.from({ length: count }, (_, index) =>
    index < literalCount ? LITERAL_CLAIM_RULE : RELATIONSHIP_RULE,
  )
  for (let index = rules.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[rules[index], rules[other]] = [rules[other], rules[index]]
  }
  return rules
}
