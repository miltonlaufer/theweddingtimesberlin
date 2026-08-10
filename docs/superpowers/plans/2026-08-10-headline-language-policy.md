# Headline Language Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent German-dominant generated headlines from being accepted or published while preserving tightly bounded German quotations and local terms.

**Architecture:** Add a focused deterministic language-policy module, then integrate it at the draft prompt/evaluation boundary and again after locked draft restoration. The existing zero-temperature draft evaluator supplies semantic language judgment for ambiguous short headlines, while the deterministic gate remains active during evaluator outages and supplies the final publication assertion.

**Tech Stack:** TypeScript, Next.js 15, LangChain `ChatOpenAI`, Zod, Vitest.

## Global Constraints

- At least 60% of classified headline language words must be English.
- Allow either one quoted German phrase of at most four words or at most two isolated German terms; never both.
- Proper names, place names, acronyms, numbers, and punctuation are neutral.
- German clauses or sentences outside the bounded quoted-phrase allowance are rejected.
- Subheadlines and excerpts remain US English only.
- Rejected drafts use an observable `headline-language:` reason and the existing retry flow.
- Do not rewrite existing published articles or change RSS metadata.
- Add no database migration.

---

## File Structure

- Create `src/lib/generation/headlineLanguage.ts`: own tokenization, deterministic assessment, shared prompt copy, and publication assertion.
- Create `src/lib/generation/headlineLanguage.test.ts`: own policy examples and boundary tests.
- Modify `src/lib/generation/draftPipeline.ts`: place policy in prompts, run deterministic assessment, and require semantic evaluator confirmation.
- Modify `src/lib/generation/draftPipeline.test.ts`: test prompt placement and evaluator/rejection integration.
- Modify `src/lib/generation/pipelineTypes.ts`: persist evaluator language fields in `DraftEvaluation`.
- Modify `src/lib/generation/generateArticle.ts`: recognize language guard errors as retryable and assert after applying the seed draft.
- Modify `src/lib/generation/generateArticle.repetition.test.ts`: cover retryability of the final language guard.

---

### Task 1: Deterministic Headline Language Policy

**Files:**

- Create: `src/lib/generation/headlineLanguage.ts`
- Create: `src/lib/generation/headlineLanguage.test.ts`

**Interfaces:**

- Consumes: a generated headline string.
- Produces: `assessHeadlineLanguage(headline: string): HeadlineLanguageAssessment`.
- Produces: `assertHeadlineLanguagePolicy(headline: string): void`.
- Produces: `HEADLINE_LANGUAGE_POLICY_PROMPT` and `HEADLINE_LANGUAGE_GUARD_PREFIX` for later integrations.

- [ ] **Step 1: Write failing policy and boundary tests**

Create `src/lib/generation/headlineLanguage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assessHeadlineLanguage, assertHeadlineLanguagePolicy } from './headlineLanguage'

describe('headline language policy', () => {
  it.each([
    'Du Arschloch, jetzt bitte mit Applaus',
    'Leihfahrräder, Parke, dann schäm dich',
    'Vom Hauseingang auf die Streaming-Privatjet-Liste',
    '„Ich fürchte am meisten meinen Vater“',
  ])('rejects German-dominant production headline %s', (headline) => {
    const result = assessHeadlineLanguage(headline)
    expect(result.passes).toBe(false)
    expect(result.reason).toContain('headline-language:')
  })

  it.each([
    'Ashtray Diplomacy at the Bürgeramt',
    'Späti Etiquette Meets Bürgeramt Logic at Midnight',
    '‘Bitte warten’ at the Hospital',
    '‘Bitte warten Sie draußen’ Becomes the Hospital’s New Customer-Service Strategy',
  ])('allows bounded German in English-led headline %s', (headline) => {
    expect(assessHeadlineLanguage(headline).passes).toBe(true)
  })

  it('allows exactly sixty percent classified English words', () => {
    const result = assessHeadlineLanguage('‘Bitte warten’ at the Hospital')
    expect(result.englishShare).toBe(0.6)
    expect(result.passes).toBe(true)
  })

  it('rejects a five-word German quotation', () => {
    expect(
      assessHeadlineLanguage(
        '‘Bitte warten Sie noch draußen’ Becomes the Hospital’s New Customer-Service Strategy',
      ).signals,
    ).toContain('german-quote-too-long')
  })

  it('rejects three isolated German terms', () => {
    const result = assessHeadlineLanguage('Späti Bürgeramt Kiez Logic Controls the Night Shift')
    expect(result.signals).toContain('too-many-isolated-german-terms')
    expect(result.passes).toBe(false)
  })

  it('rejects mixing a German quotation with an isolated German term', () => {
    const result = assessHeadlineLanguage('‘Bitte warten’ at the Bürgeramt Service Desk')
    expect(result.signals).toContain('mixed-german-allowances')
    expect(result.passes).toBe(false)
  })

  it('throws the publication guard prefix for an invalid headline', () => {
    expect(() => assertHeadlineLanguagePolicy('Du Arschloch, jetzt bitte mit Applaus')).toThrow(
      'HEADLINE_LANGUAGE_GUARD:',
    )
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/lib/generation/headlineLanguage.test.ts
```

Expected: FAIL because `./headlineLanguage` does not exist.

- [ ] **Step 3: Implement the minimal deterministic module**

Create `src/lib/generation/headlineLanguage.ts` with these public types/constants and behavior:

```ts
export const HEADLINE_LANGUAGE_GUARD_PREFIX = 'HEADLINE_LANGUAGE_GUARD'

export const HEADLINE_LANGUAGE_POLICY_PROMPT = [
  'HEADLINE LANGUAGE POLICY (MANDATORY):',
  '- The headline must be English-led: at least 60% of classified language words must be English.',
  '- You may use EITHER one quoted German phrase of at most four words OR at most two isolated German terms, never both.',
  '- Do not write a full German clause or sentence.',
  '- A German RSS headline is source material only. Translate and rewrite it into an original English-led headline.',
  '- Subheadline and excerpt must be entirely in US English.',
].join('\n')

export type HeadlineLanguageAssessment = {
  passes: boolean
  englishShare: number
  englishWordCount: number
  germanWordCount: number
  germanQuoteCount: number
  maxGermanQuoteWords: number
  isolatedGermanWordCount: number
  signals: string[]
  reason: string
}

export function assessHeadlineLanguage(headline: string): HeadlineLanguageAssessment
export function assertHeadlineLanguagePolicy(headline: string): void
```

Implementation rules:

1. Tokenize words with `/\p{L}+/gu`; normalize using `toLocaleLowerCase('de-DE')`.
2. Extract paired quoted spans for `“…”`, `„…“`, `‘…’`, `"…"`, and `'…'`, retaining character ranges so German tokens can be separated into quoted and unquoted groups.
3. Maintain compact evidence sets for common English and German function words plus every regression/boundary word in the tests. Include German-local terms `bürgeramt`, `späti`, and `kiez` in German evidence. Include English headline words such as `the`, `at`, `after`, `becomes`, `hospital`, `service`, `strategy`, `logic`, `night`, and `shift` in English evidence.
4. Treat tokens containing `ä`, `ö`, `ü`, or `ß`, and tokens matching German suffixes `/(?:ung|ungen|keit|keiten|heit|heiten|schaft|schaften|chen|lein|isch|ischen|ieren|iert)$/u`, as German evidence unless present in the English evidence set. Require at least six letters for suffix matching so English words such as `bar` are not misclassified.
5. Exclude recognized proper/place names, acronyms, and numeric-only tokens as neutral. Start the neutral set with `berlin`, `wedding`, `afd`, `bvg`, `hertha`, `söder`, and `leipzig`.
6. Compute `englishShare = english / (english + german)`. When no German evidence exists, return `englishShare: 1` and pass the language-share rule. When German evidence exists without English evidence, return `englishShare: 0`.
7. A quoted span counts as a German phrase when it contains German evidence. Reject more than one German quoted span or a German quoted span longer than four total words.
8. German evidence outside a German quoted span counts as isolated German terms. Reject more than two, reject mixing quoted and isolated allowances, and reject unquoted adjacent German evidence because it forms a clause rather than isolated terms.
9. Reject `englishShare < 0.6`. Populate stable signals: `english-share-below-60`, `german-quote-too-long`, `multiple-german-quotes`, `too-many-isolated-german-terms`, `mixed-german-allowances`, and `unquoted-german-clause`.
10. Prefix all rejection reasons with `headline-language:`. `assertHeadlineLanguagePolicy` throws `${HEADLINE_LANGUAGE_GUARD_PREFIX}: ${assessment.reason}`.

Use this concrete implementation shape; expand the two evidence sets only when a failing policy test demonstrates a missing token:

```ts
type Language = 'english' | 'german' | 'neutral'
type WordToken = { raw: string; normalized: string; start: number; end: number; language: Language }
type QuoteRange = { start: number; end: number }

const ENGLISH_EVIDENCE = new Set(
  [
    'a',
    'after',
    'and',
    'ashtray',
    'at',
    'becomes',
    'by',
    'controls',
    'customer',
    'desk',
    'diplomacy',
    'economy',
    'english',
    'etiquette',
    'every',
    'for',
    'founder',
    'from',
    'hospital',
    'in',
    'is',
    'logic',
    'meets',
    'midnight',
    'new',
    'night',
    'of',
    'on',
    'rules',
    'service',
    'shift',
    'strategy',
    'the',
    'to',
    'with',
  ].map((word) => word.toLocaleLowerCase('en-US')),
)

const GERMAN_EVIDENCE = new Set(
  [
    'aber',
    'alle',
    'als',
    'am',
    'arschloch',
    'auf',
    'aus',
    'bei',
    'bitte',
    'bürgeramt',
    'dann',
    'das',
    'dass',
    'dich',
    'die',
    'draußen',
    'du',
    'ein',
    'eine',
    'für',
    'fürchte',
    'hauseingang',
    'ich',
    'im',
    'ist',
    'jetzt',
    'kiez',
    'leihfahrräder',
    'liste',
    'meinen',
    'meisten',
    'mit',
    'nicht',
    'noch',
    'nur',
    'oder',
    'parke',
    'privatjet',
    'schäm',
    'sie',
    'späti',
    'und',
    'vater',
    'vom',
    'warten',
  ].map((word) => word.toLocaleLowerCase('de-DE')),
)

const NEUTRAL_EVIDENCE = new Set(['afd', 'berlin', 'bvg', 'hertha', 'leipzig', 'söder', 'wedding'])
const WORD_PATTERN = /\p{L}+/gu
const QUOTE_PATTERN = /“[^”]*”|„[^“]*“|‘[^’]*’|"[^"]*"|'[^']*'/gu
const GERMAN_SUFFIX_PATTERN =
  /(?:ung|ungen|keit|keiten|heit|heiten|schaft|schaften|chen|lein|isch|ischen|ieren|iert)$/u

function classifyWord(raw: string): Language {
  const normalized = raw.toLocaleLowerCase('de-DE')
  if (NEUTRAL_EVIDENCE.has(normalized) || (raw.length > 1 && raw === raw.toUpperCase())) {
    return 'neutral'
  }
  if (ENGLISH_EVIDENCE.has(normalized)) return 'english'
  if (GERMAN_EVIDENCE.has(normalized)) return 'german'
  if (/[äöüß]/u.test(normalized)) return 'german'
  if (normalized.length >= 6 && GERMAN_SUFFIX_PATTERN.test(normalized)) return 'german'
  return 'neutral'
}

function tokenize(headline: string): WordToken[] {
  return Array.from(headline.matchAll(WORD_PATTERN), (match) => {
    const start = match.index ?? 0
    return {
      raw: match[0],
      normalized: match[0].toLocaleLowerCase('de-DE'),
      start,
      end: start + match[0].length,
      language: classifyWord(match[0]),
    }
  })
}

function quoteRanges(headline: string): QuoteRange[] {
  return Array.from(headline.matchAll(QUOTE_PATTERN), (match) => {
    const start = match.index ?? 0
    return { start, end: start + match[0].length }
  })
}

function containingQuote(token: WordToken, ranges: QuoteRange[]): QuoteRange | undefined {
  return ranges.find((range) => token.start >= range.start && token.end <= range.end)
}

export function assessHeadlineLanguage(headline: string): HeadlineLanguageAssessment {
  const tokens = tokenize(headline)
  const ranges = quoteRanges(headline)
  const english = tokens.filter((token) => token.language === 'english')
  const german = tokens.filter((token) => token.language === 'german')
  const germanQuoteRanges = ranges.filter((range) =>
    german.some((token) => token.start >= range.start && token.end <= range.end),
  )
  const maxGermanQuoteWords = Math.max(
    0,
    ...germanQuoteRanges.map(
      (range) =>
        tokens.filter((token) => token.start >= range.start && token.end <= range.end).length,
    ),
  )
  const isolatedGerman = german.filter((token) => !containingQuote(token, germanQuoteRanges))
  const isolatedIndexes = isolatedGerman.map((token) => tokens.indexOf(token))
  const hasAdjacentIsolatedGerman = isolatedIndexes.some(
    (index, position) => position > 0 && index === isolatedIndexes[position - 1]! + 1,
  )
  const classifiedCount = english.length + german.length
  const englishShare =
    german.length === 0 ? 1 : classifiedCount === 0 ? 0 : english.length / classifiedCount
  const signals: string[] = []

  if (englishShare < 0.6) signals.push('english-share-below-60')
  if (germanQuoteRanges.length > 1) signals.push('multiple-german-quotes')
  if (maxGermanQuoteWords > 4) signals.push('german-quote-too-long')
  if (isolatedGerman.length > 2) signals.push('too-many-isolated-german-terms')
  if (germanQuoteRanges.length > 0 && isolatedGerman.length > 0) {
    signals.push('mixed-german-allowances')
  }
  if (hasAdjacentIsolatedGerman) signals.push('unquoted-german-clause')

  const passes = signals.length === 0
  return {
    passes,
    englishShare,
    englishWordCount: english.length,
    germanWordCount: german.length,
    germanQuoteCount: germanQuoteRanges.length,
    maxGermanQuoteWords,
    isolatedGermanWordCount: isolatedGerman.length,
    signals,
    reason: passes ? 'headline-language: accepted' : `headline-language: ${signals.join(', ')}`,
  }
}

export function assertHeadlineLanguagePolicy(headline: string): void {
  const assessment = assessHeadlineLanguage(headline)
  if (!assessment.passes) {
    throw new Error(`${HEADLINE_LANGUAGE_GUARD_PREFIX}: ${assessment.reason}`)
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run src/lib/generation/headlineLanguage.test.ts
```

Expected: PASS for all policy examples and boundaries.

- [ ] **Step 5: Commit the deterministic policy**

```bash
git add src/lib/generation/headlineLanguage.ts src/lib/generation/headlineLanguage.test.ts
git commit -m "feat(generation): gate headline language"
```

---

### Task 2: Draft Prompt and Evaluation Enforcement

**Files:**

- Modify: `src/lib/generation/draftPipeline.ts:1-25, 390-610`
- Modify: `src/lib/generation/draftPipeline.test.ts`
- Modify: `src/lib/generation/pipelineTypes.ts:20-45`

**Interfaces:**

- Consumes: `HEADLINE_LANGUAGE_POLICY_PROMPT` and `assessHeadlineLanguage` from Task 1.
- Produces: `DraftEvaluation.tone.languagePass`, `englishShare`, and `germanUsageSummary`.
- Preserves: existing draft retry behavior and `DraftEvaluation` storage shape, adding fields only.

- [ ] **Step 1: Write failing prompt and deterministic rejection tests**

Extend `src/lib/generation/draftPipeline.test.ts` imports to include `evaluateDraftCandidate`, then add:

```ts
it('puts the English-led policy before a German RSS topic', async () => {
  process.env.OPENAI_API_KEY = 'test-key'
  mocks.invoke.mockResolvedValue({
    content: JSON.stringify({
      headline: 'AfD Campaign Turns Insults Into Applause',
      subheadline: 'The opening event packages brutality as authenticity.',
      excerpt: 'Campaigners hope the crowd mistakes bullying for courage.',
    }),
  })

  await generateDraftCandidate({
    slot: {
      forceDrugsTechno: false,
      forceStartup: false,
      forceRss: true,
      forceOpinion: false,
      includeTopics: true,
    },
    topicSummary: '- [berliner-zeitung] „Du Arschloch, was soll das?“ Wahlkampfauftakt der AfD',
    recentCoverage: [],
    blacklistSummary: '',
    acceptedDrafts: [],
    useRandomModes: false,
  })

  const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
  const combined = messages.map((message) => message.content).join('\n')
  expect(combined).toContain('at least 60% of classified language words must be English')
  expect(combined.indexOf('HEADLINE LANGUAGE POLICY')).toBeLessThan(
    combined.indexOf('Assigned topic/news hook'),
  )
})

it('rejects a German-dominant draft before invoking the tone evaluator', async () => {
  const evaluation = await evaluateDraftCandidate({
    candidate: {
      headline: 'Du Arschloch, jetzt bitte mit Applaus',
      subheadline: 'Campaigners package brutality as authenticity.',
      excerpt: 'The crowd mistakes bullying for courage.',
    },
    recentCoverage: [],
    acceptedDrafts: [],
  })

  expect(evaluation.accepted).toBe(false)
  expect(evaluation.reason).toContain('headline-language:')
  expect(mocks.invoke).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the two focused tests and verify RED**

Run:

```bash
npx vitest run src/lib/generation/draftPipeline.test.ts
```

Expected: FAIL because the draft prompt lacks the complete policy and `evaluateDraftCandidate` does not reject the German headline.

- [ ] **Step 3: Add deterministic draft enforcement and prompt placement**

In `src/lib/generation/draftPipeline.ts`:

1. Import `HEADLINE_LANGUAGE_POLICY_PROMPT` and `assessHeadlineLanguage`.
2. Insert `HEADLINE_LANGUAGE_POLICY_PROMPT` in `systemPrompt` immediately after the publication-role line, before humor/style instructions.
3. Insert it again in `userPrompt` immediately before `Mode:` and remove the weaker final `- US English only.` line.
4. In `evaluateDraftCandidate`, call `assessHeadlineLanguage(params.candidate.headline)` after the deterministic repetition fingerprint is built but before similarity/taste/tone evaluation. For failure, return:

```ts
return {
  accepted: false,
  reason: headlineLanguage.reason,
  repetition,
  tone: {
    funScore: 1,
    mercilessScore: 1,
    specificityScore: 1,
    languagePass: false,
    englishShare: headlineLanguage.englishShare,
    germanUsageSummary: headlineLanguage.signals.join(', '),
    pass: false,
    reason: 'Tone evaluation skipped because headline language was rejected.',
  },
}
```

- [ ] **Step 4: Extend the evaluator test contract and verify RED**

Add this test to `src/lib/generation/draftPipeline.test.ts`:

```ts
it('rejects an evaluator-detected language violation that passes local heuristics', async () => {
  process.env.OPENAI_API_KEY = 'test-key'
  mocks.invoke.mockResolvedValue({
    content: JSON.stringify({
      funScore: 8,
      mercilessScore: 8,
      specificityScore: 8,
      languagePass: false,
      englishShare: 0.4,
      germanUsageSummary: 'German clause dominates the headline',
      pass: false,
      reason: 'Language policy failed.',
    }),
  })

  const evaluation = await evaluateDraftCandidate({
    candidate: {
      headline: 'Nachtschicht Rules the Founder Economy',
      subheadline: 'A startup discovers that exhaustion can be invoiced.',
      excerpt: 'Founders turn late work into a branded moral hierarchy.',
    },
    recentCoverage: [],
    acceptedDrafts: [],
  })

  expect(evaluation.accepted).toBe(false)
  expect(evaluation.reason).toContain('headline-language:')
})
```

Run:

```bash
npx vitest run src/lib/generation/draftPipeline.test.ts
```

Expected: FAIL because the tone schema and acceptance logic do not consume language fields.

- [ ] **Step 5: Extend the evaluator schema, prompt, types, and fallback**

In `src/lib/generation/pipelineTypes.ts`, extend `DraftEvaluation['tone']`:

```ts
languagePass: boolean
englishShare: number
germanUsageSummary: string
```

In `src/lib/generation/draftPipeline.ts`, extend `DraftToneSchema` with:

```ts
languagePass: z.boolean(),
englishShare: z.number().min(0).max(1),
germanUsageSummary: z.string().max(200),
```

Add `HEADLINE_LANGUAGE_POLICY_PROMPT` to the evaluator system prompt and update its JSON schema string with those fields. Tell the evaluator to count only classified English/German words, treat proper names as neutral, and set `languagePass=false` when the 60%/quotation/isolated-term policy fails or when subheadline/excerpt are not US English.

After evaluator invocation, reject language before computing `tonePass`:

```ts
if (!tone.languagePass || tone.englishShare < 0.6) {
  return {
    accepted: false,
    reason: `headline-language: ${tone.germanUsageSummary || tone.reason}`,
    repetition,
    tone,
  }
}
```

Update every deterministic/taste fallback tone object with the new fields. When the evaluator request fails after the deterministic check passed, use:

```ts
languagePass: true,
englishShare: headlineLanguage.englishShare,
germanUsageSummary: 'Deterministic language gate passed; evaluator unavailable.',
```

- [ ] **Step 6: Run draft pipeline tests and verify GREEN**

Run:

```bash
npx vitest run src/lib/generation/draftPipeline.test.ts src/lib/generation/generateArticle.repetition.test.ts
```

Expected: PASS; TypeScript compilation through Vitest reports no missing tone fields.

- [ ] **Step 7: Commit draft enforcement**

```bash
git add src/lib/generation/draftPipeline.ts src/lib/generation/draftPipeline.test.ts src/lib/generation/pipelineTypes.ts
git commit -m "fix(generation): reject German-led drafts"
```

---

### Task 3: Locked-Draft Publication Defense and Verification

**Files:**

- Modify: `src/lib/generation/generateArticle.ts:150-185, 4796-4810, 4848-4865`
- Modify: `src/lib/generation/generateArticle.repetition.test.ts`

**Interfaces:**

- Consumes: `assertHeadlineLanguagePolicy` and `HEADLINE_LANGUAGE_GUARD_PREFIX` from Task 1.
- Produces: retryable final-article rejection after server-owned seed fields are restored.

- [ ] **Step 1: Write the failing retryability regression test**

Update imports in `src/lib/generation/generateArticle.repetition.test.ts`:

```ts
import { assertHeadlineLanguagePolicy } from './headlineLanguage'
```

Add:

```ts
it('treats a locked-headline language guard failure as retryable', () => {
  let caught: unknown
  try {
    assertHeadlineLanguagePolicy('Du Arschloch, jetzt bitte mit Applaus')
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(Error)
  expect(isRetryableGenerationError(caught)).toBe(true)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/lib/generation/generateArticle.repetition.test.ts
```

Expected: FAIL because `isRetryableGenerationError` recognizes repetition and ceremony errors but not `HEADLINE_LANGUAGE_GUARD`.

- [ ] **Step 3: Add the final guard after locked draft restoration**

In `src/lib/generation/generateArticle.ts`:

1. Import `assertHeadlineLanguagePolicy` and `HEADLINE_LANGUAGE_GUARD_PREFIX`.
2. Extend `isRetryableGenerationError`:

```ts
if (error.message.includes(HEADLINE_LANGUAGE_GUARD_PREFIX)) return true
```

3. In both the normal and repaired result paths, call the assertion immediately after `finalizeGeneratedExcerpt(applySeedDraft(...))` and before locked-draft coherence/similarity checks:

```ts
assertHeadlineLanguagePolicy(validated.headline)
```

and:

```ts
assertHeadlineLanguagePolicy(repairedWithSeed.headline)
```

This ordering is essential: the assertion must inspect the restored server-owned headline, not the model’s temporary translated headline.

- [ ] **Step 4: Run focused generation tests and verify GREEN**

Run:

```bash
npx vitest run src/lib/generation/headlineLanguage.test.ts src/lib/generation/draftPipeline.test.ts src/lib/generation/generateArticle.repetition.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run complete verification**

Run each command separately and fix only failures caused by this change:

```bash
npm run typecheck
npm test
npm run lint
git diff --check
```

Expected: all commands exit 0; Vitest reports all files passing; ESLint and `git diff --check` produce no errors.

- [ ] **Step 6: Commit publication defense**

```bash
git add src/lib/generation/generateArticle.ts src/lib/generation/generateArticle.repetition.test.ts
git commit -m "fix(generation): guard locked headlines"
```

- [ ] **Step 7: Review the final diff against the approved specification**

Run:

```bash
git status --short
git log -4 --oneline
git diff HEAD~3 --check
git diff HEAD~3 --stat
```

Expected: only the approved language-policy files and plan/spec documentation changed; no existing article rows, RSS metadata, or migrations changed.
