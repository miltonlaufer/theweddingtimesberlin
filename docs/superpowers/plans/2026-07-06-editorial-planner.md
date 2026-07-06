# Editorial Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded/random generation slot mix with a deterministic editorial planner that looks at recent articles, caps saturated themes, and guarantees RSS/current-news slots when feeds are available.

**Architecture:** Add a pure planner module that classifies recent coverage into editorial buckets and emits `SlotConfig[]` plus a compact summary. Integrate it into `runGenerationPipeline` before job items are created, and pass optional slot-level editor directions through draft generation.

**Tech Stack:** TypeScript, Next.js route handlers, Payload, Vitest.

---

### Task 1: Pure Editorial Planner

**Files:**

- Create: `src/lib/generation/editorialPlanner.ts`
- Create: `src/lib/generation/editorialPlanner.test.ts`
- Modify: `src/lib/generation/pipelineTypes.ts`

- [ ] **Step 1: Write failing planner tests**

```ts
import { describe, expect, it } from 'vitest'
import { planEditorialSlots } from './editorialPlanner'

describe('planEditorialSlots', () => {
  it('guarantees RSS slots without forcing them into drugs/nightlife', () => {
    const plan = planEditorialSlots({
      count: 6,
      hasRssTopics: true,
      forceOpinionFirst: false,
      recentCoverage: [],
      includeHumorPerspectiveMethod: () => false,
    })

    const rssSlots = plan.slots.filter((slot) => slot.forceRss)
    expect(rssSlots).toHaveLength(2)
    expect(rssSlots.every((slot) => slot.forceDrugsTechno === false)).toBe(true)
  })

  it('does not force drugs/nightlife when recent coverage is saturated', () => {
    const plan = planEditorialSlots({
      count: 6,
      hasRssTopics: true,
      forceOpinionFirst: false,
      recentCoverage: Array.from({ length: 10 }, (_, index) => ({
        headline: `Ketamine Club Door Policy ${index}`,
        excerpt: 'Dealers, bouncers, techno, and pills.',
        categorySlug: 'nightlife',
      })),
      includeHumorPerspectiveMethod: () => false,
    })

    expect(plan.summary.saturatedThemes).toContain('drugs-nightlife')
    expect(plan.slots.some((slot) => slot.forceDrugsTechno === true)).toBe(false)
  })

  it('adds concrete editor direction for non-RSS undercovered local slots', () => {
    const plan = planEditorialSlots({
      count: 6,
      hasRssTopics: false,
      forceOpinionFirst: false,
      recentCoverage: [],
      includeHumorPerspectiveMethod: () => false,
    })

    expect(plan.slots.some((slot) => slot.editorDirection?.includes('bureaucracy'))).toBe(true)
    expect(plan.slots.some((slot) => slot.editorDirection?.includes('Kiez'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run planner tests to verify RED**

Run: `npx vitest run src/lib/generation/editorialPlanner.test.ts`

Expected: FAIL because `editorialPlanner.ts` does not exist.

- [ ] **Step 3: Implement planner**

Create `EditorialTheme`, `classifyRecentCoverage`, and `planEditorialSlots`. Extend `SlotConfig` with optional `themeBucket` and `editorDirection`.

- [ ] **Step 4: Run planner tests to verify GREEN**

Run: `npx vitest run src/lib/generation/editorialPlanner.test.ts`

Expected: PASS.

### Task 2: Pipeline Integration

**Files:**

- Modify: `src/lib/generation/runGenerationPipeline.ts`
- Modify: `src/app/api/internal/generation/slot-worker/route.ts`
- Modify: `src/app/api/internal/generation/retry-draft/route.ts`
- Modify: `src/app/api/internal/generation/process-item/route.ts`
- Modify: `src/lib/generation/draftPipeline.ts`

- [ ] **Step 1: Replace `computeSlotConfigs`**

Use `planEditorialSlots` after `recentCoverage` is available. Store `editorialPlan.summary` in job metadata.

- [ ] **Step 2: Pass slot editor direction**

Add `editorDirection` and `themeBucket` to slot request schemas. In `generateDraftCandidate`, use `params.editorDirection ?? params.slot.editorDirection`.

- [ ] **Step 3: Preserve redraft behavior**

When process-item asks for a replacement draft after repetition failure, pass the same slot editor direction to the draft pipeline.

- [ ] **Step 4: Run route and generation tests**

Run:

```bash
npx vitest run src/lib/generation/editorialPlanner.test.ts src/lib/generation/draftPipeline.test.ts src/lib/generation/generateArticle.repetition.test.ts src/app/api/internal/generation/process-item/route.test.ts src/app/api/internal/generation/slot-worker/route.test.ts
```

Expected: PASS.

### Task 3: Verification

**Files:**

- No new production files.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: exit 0, including `Generating static pages (33/33)`.
