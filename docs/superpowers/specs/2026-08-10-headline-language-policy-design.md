# Headline Language Policy Design

## Problem

Automatic generation sometimes publishes headlines that are predominantly German even though The Wedding Times is an English-language publication. German RSS headlines and Berlin-local prompt context can anchor the draft model in German. The draft schema and tone evaluator currently accept those results, and the full-article language pass cannot repair a server-locked draft headline because the original seed is restored before publication.

## Editorial Policy

Generated headlines must be English-led:

- At least 60% of classified language words must be English. Proper names, place names, acronyms, numbers, and punctuation are excluded from the denominator.
- A headline may contain either one quoted German phrase of at most four words or at most two isolated German terms.
- A headline may not use both allowances.
- German clauses or sentences outside the bounded quoted-phrase allowance are rejected.
- Subheadlines and excerpts remain US English only.
- Proper names, place names, acronyms, numbers, and punctuation are neutral and do not count as German allowances.

Examples that should pass:

- `Ashtray Diplomacy at the Bürgeramt`
- `Späti Etiquette Meets Bürgeramt Logic at Midnight`
- `‘Bitte warten’ at the Hospital`
- `‘Bitte warten Sie draußen’ Becomes the Hospital’s New Customer-Service Strategy`

Examples that should fail:

- `Du Arschloch, jetzt bitte mit Applaus`
- `Leihfahrräder, Parke, dann schäm dich`
- `Vom Hauseingang auf die Streaming-Privatjet-Liste`
- `„Ich fürchte am meisten meinen Vater“`
- A quoted German phrase longer than four words, even when the rest of the title is English.
- A title containing three or more isolated German terms.

## Approach

Use a hybrid gate at the draft boundary:

1. Put the complete language rule prominently in both the draft system prompt and its rules section. German RSS topics are source material and must not determine the output language.
2. Add a deterministic headline-language assessment that tokenizes Unicode words, recognizes quoted spans, treats proper names and local names as neutral, and uses compact English/German evidence lists plus German-specific orthographic and morphological signals.
3. Reject clear violations before the expensive tone-evaluation call. The rejection reason begins with `headline-language:` so the existing draft retry loop can request a replacement.
4. Extend the existing zero-temperature pitch evaluator to report language compliance and estimated English share. This handles genuinely ambiguous short titles that deterministic classification cannot settle confidently.
5. If the evaluator is unavailable, preserve the existing tone fallback but never override a deterministic language rejection.
6. Assert the deterministic policy again after the locked seed draft is reapplied, immediately before the article is returned for publication.

The deterministic layer owns hard structural limits and clear language violations. The evaluator supplies semantic judgment for ambiguous words; it is not the sole enforcement mechanism.

## Components

### Headline language assessment

A focused generation helper exports an assessment containing:

- `passes`
- estimated English share
- German word count
- quoted German phrase count and maximum length
- isolated German term count
- machine-readable signals
- a concise rejection reason

Unknown words are neutral rather than automatically German. The English share is `English tokens / (English tokens + German tokens)`. A headline with German evidence but no English evidence fails conservatively. Known Berlin terms such as `Bürgeramt`, `Späti`, and `Kiez` are allowed only through the German-term allowance; they are not silently counted as English.

### Draft generation and evaluation

The prompt states the policy before topic and recent-coverage material, then repeats it in the final rules. `evaluateDraftCandidate` runs deterministic language validation before similarity, taste, and tone checks. Clear failures return the standard rejected `DraftEvaluation`, allowing existing retries and observability to work unchanged.

The tone evaluator adds language fields and receives the same policy. A language failure is reported as `headline-language:` even when humor scores pass.

### Publication defense

After `applySeedDraft`, the final article headline is checked again. This prevents translation, repair, critique, or locked-draft ordering from bypassing the policy. A dedicated headline-language guard prefix is added to `isRetryableGenerationError`, allowing the existing process-item retry path to request a new draft instead of silently publishing a bad headline.

## Failure Behavior

- A failing draft is rejected and regenerated within the existing attempt limit.
- A generation batch may fail an item after exhausting retries; it must not publish a German-dominant headline as fallback.
- Evaluator outages retain deterministic enforcement.
- Logs and stored draft evaluations expose the `headline-language:` reason.

## Testing

Follow test-driven development:

1. Add failing unit tests for the production regressions and each allowed form.
2. Add boundary cases for exactly 60% English, four quoted German words, five quoted German words, two isolated terms, and three isolated terms.
3. Add a draft-evaluation test proving a language violation is rejected before tone acceptance can override it.
4. Add a finalization/locked-draft regression test proving the original German seed cannot be restored into a publishable result.
5. Run the focused generation tests, then the full unit suite, typecheck, and lint.

## Scope

This change affects automatically generated article headlines, subheadlines, and excerpts. It does not rewrite existing published articles or alter RSS source metadata. No database migration is required.
