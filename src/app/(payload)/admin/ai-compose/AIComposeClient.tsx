'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

const STORY_DESCRIPTION_MAX = 2000

type RssTopic = {
  source: string
  title: string
  url: string
  publishedAt?: string
}

type Draft = {
  headline: string
  subheadline: string | null
  excerpt: string | null
}

type DraftEvaluation = {
  accepted: boolean
  reason: string
  repetition: {
    overlaps: boolean
    score: number
    reason: string
    matchedReference: string | null
  }
  tone: {
    funScore: number
    mercilessScore: number
    specificityScore: number
    pass: boolean
    reason: string
  }
}

type GeneratedArticle = {
  headline: string
  subheadline: string | null
  excerpt: string | null
  bodyMarkdown: string
  categorySlug: string
  authorSlug: string
  newAuthorName: string | null
  newAuthorTitle: string | null
  newAuthorBio: string | null
  layout: 'standard' | 'wide' | 'opinion'
  isFeatured: boolean
  isHeadline: boolean
  imageCaption: string | null
  imagePrompt: string | null
  sourceRssTopic: string | null
  canonicalSourceAuthor: string | null
  canonicalSourceStory: string | null
}

type PublishResult = {
  created: {
    id: string | number
    slug: string
    url: string
    categorySlug: string
  }
  revalidatedPaths: string[]
  instagram?: {
    attempted?: boolean
    queuedByArticleHook?: boolean
    skipped?: boolean
    reason?: string
  }
}

type DraftResult = {
  draft: Draft
  sourceRssTopic: string | null
  evaluation: DraftEvaluation
  useHumorPerspectiveMethod?: boolean
}

type GenerationOptions = {
  useRandomModes: boolean
  includeBerlinThemes: boolean
  useRssTopic: boolean
  forceDrugsTechno: boolean
  forceStartup: boolean
  forceOpinion: boolean
  strictTopicFocus: boolean
}

const MANUAL_DRAFT_EVALUATION: DraftEvaluation = {
  accepted: false,
  reason: 'Manual draft mode (auto-evaluation not run)',
  repetition: {
    overlaps: false,
    score: 0,
    reason: 'Not evaluated',
    matchedReference: null,
  },
  tone: {
    funScore: 0,
    mercilessScore: 0,
    specificityScore: 0,
    pass: false,
    reason: 'Not evaluated',
  },
}

function toNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function callAiCompose<T>(body: unknown): Promise<T> {
  const response = await fetch('/api/admin/ai-compose', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
  } & T

  if (!response.ok || json.ok === false) {
    throw new Error(json.error ?? `Request failed (${response.status})`)
  }

  return json
}

function displayError(error: unknown): string {
  if (error instanceof Error) {
    const raw = error.message.trim()
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const parsed = JSON.parse(raw) as Array<{ path?: string[]; message?: string }>
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
            .map((issue) => {
              const path =
                Array.isArray(issue.path) && issue.path.length > 0
                  ? issue.path.join('.')
                  : 'request'
              return `${path}: ${issue.message ?? 'Invalid value'}`
            })
            .join(' | ')
        }
      } catch {
        // Keep raw message if parsing fails.
      }
    }
    return raw
  }
  return 'Unexpected error'
}

export function AIComposeClient() {
  const [topics, setTopics] = useState<RssTopic[]>([])
  const [topicsLoading, setTopicsLoading] = useState(true)

  const [rssTopic, setRssTopic] = useState('')
  const [storyDescription, setStoryDescription] = useState('')
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>({
    useRandomModes: false,
    includeBerlinThemes: true,
    useRssTopic: true,
    forceDrugsTechno: false,
    forceStartup: false,
    forceOpinion: false,
    strictTopicFocus: true,
  })

  const [draftFeedback, setDraftFeedback] = useState('')
  const [articleFeedback, setArticleFeedback] = useState('')
  const [imageFeedback, setImageFeedback] = useState('')

  const [draftHistory, setDraftHistory] = useState<Draft[]>([])
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null)
  const [draftApproved, setDraftApproved] = useState(false)

  const [article, setArticle] = useState<GeneratedArticle | null>(null)
  const [usedRssTopic, setUsedRssTopic] = useState<string | null>(null)
  const [articleApproved, setArticleApproved] = useState(false)
  const [isManualArticle, setIsManualArticle] = useState(false)

  const [imagePrompt, setImagePrompt] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageApproved, setImageApproved] = useState(false)

  const [setAsHeadline, setSetAsHeadline] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)

  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasTopicInput = useMemo(
    () =>
      (generationOptions.useRssTopic && rssTopic.trim().length > 0) ||
      storyDescription.trim().length > 0,
    [generationOptions.useRssTopic, rssTopic, storyDescription],
  )

  function updateOption<K extends keyof GenerationOptions>(key: K, value: GenerationOptions[K]) {
    setGenerationOptions((prev) => {
      if (key === 'forceDrugsTechno' && value === true) {
        return { ...prev, forceDrugsTechno: true, forceStartup: false }
      }
      if (key === 'forceStartup' && value === true) {
        return { ...prev, forceStartup: true, forceDrugsTechno: false }
      }
      return { ...prev, [key]: value }
    })
  }

  function resetDownstreamFromDraft() {
    setDraftApproved(false)
    setArticle(null)
    setUsedRssTopic(null)
    setIsManualArticle(false)
    setArticleApproved(false)
    setImagePrompt('')
    setImageUrl(null)
    setImageApproved(false)
    setPublishResult(null)
  }

  function resetDownstreamFromArticle() {
    setArticleApproved(false)
    setImageUrl(null)
    setImageApproved(false)
    setPublishResult(null)
  }

  function onStartManualDraft() {
    const nextDraft: Draft = {
      headline: '',
      subheadline: null,
      excerpt: null,
    }
    setError(null)
    setDraftResult({
      draft: nextDraft,
      sourceRssTopic: generationOptions.useRssTopic ? rssTopic.trim() || null : null,
      evaluation: MANUAL_DRAFT_EVALUATION,
    })
    resetDownstreamFromDraft()
  }

  function onUpdateDraftField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraftResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        draft: {
          ...prev.draft,
          [key]: value,
        },
        evaluation: {
          ...MANUAL_DRAFT_EVALUATION,
          reason: 'Edited manually (auto-evaluation no longer current)',
        },
      }
    })
    resetDownstreamFromDraft()
  }

  function onStartManualArticle() {
    if (!draftResult || !draftApproved) {
      setError('Approve a draft before starting a manual article.')
      return
    }

    const headline = draftResult.draft.headline.trim()
    const manualArticle: GeneratedArticle = {
      headline,
      subheadline: draftResult.draft.subheadline,
      excerpt: draftResult.draft.excerpt,
      bodyMarkdown: headline ? `# ${headline}\n\n` : '',
      categorySlug: generationOptions.forceOpinion ? 'opinion' : 'kiez',
      authorSlug: 'wedding-times-desk',
      newAuthorName: 'Wedding Times Desk',
      newAuthorTitle: null,
      newAuthorBio: null,
      layout: generationOptions.forceOpinion ? 'opinion' : 'standard',
      isFeatured: false,
      isHeadline: false,
      imageCaption: null,
      imagePrompt: headline ? `Satirical editorial illustration for: ${headline}` : null,
      sourceRssTopic: draftResult.sourceRssTopic ?? null,
      canonicalSourceAuthor: null,
      canonicalSourceStory: null,
    }

    setError(null)
    setArticle(manualArticle)
    setUsedRssTopic(draftResult.sourceRssTopic ?? null)
    setIsManualArticle(true)
    setImagePrompt(manualArticle.imagePrompt ?? '')
    resetDownstreamFromArticle()
  }

  function onUpdateArticleField<K extends keyof GeneratedArticle>(
    key: K,
    value: GeneratedArticle[K],
  ) {
    setArticle((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [key]: value,
      }
    })
    if (key === 'imagePrompt') {
      setImagePrompt((value as string | null) ?? '')
    }
    resetDownstreamFromArticle()
  }

  function onApproveDraft() {
    const headlineLength = draftResult?.draft.headline.trim().length ?? 0
    if (headlineLength < 10) {
      setError('Draft headline must be at least 10 characters before approval.')
      return
    }

    setDraftApproved(true)
    setArticle(null)
    setUsedRssTopic(null)
    setIsManualArticle(false)
    setArticleApproved(false)
    setImagePrompt('')
    setImageUrl(null)
    setImageApproved(false)
    setPublishResult(null)
  }

  function onApproveArticle() {
    if (!article) {
      setError('Generate or write an article before approval.')
      return
    }
    if (article.headline.trim().length < 10) {
      setError('Article headline must be at least 10 characters before approval.')
      return
    }
    if (article.categorySlug.trim().length < 1) {
      setError('Category slug is required before article approval.')
      return
    }
    if (article.authorSlug.trim().length < 1) {
      setError('Author slug is required before article approval.')
      return
    }

    setArticleApproved(true)
    setImageUrl(null)
    setImageApproved(false)
    setPublishResult(null)
  }

  useEffect(() => {
    let mounted = true
    setTopicsLoading(true)

    callAiCompose<{ topics: RssTopic[] }>({ action: 'getTopics' })
      .then((result) => {
        if (!mounted) return
        setTopics(result.topics ?? [])
      })
      .catch((e) => {
        if (!mounted) return
        setError(displayError(e))
      })
      .finally(() => {
        if (!mounted) return
        setTopicsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  async function runStep<T>(label: string, task: () => Promise<T>): Promise<T | null> {
    try {
      setWorking(label)
      setError(null)
      const result = await task()
      return result
    } catch (e) {
      setError(displayError(e))
      return null
    } finally {
      setWorking(null)
    }
  }

  async function onGenerateDraft() {
    if (!hasTopicInput) {
      setError('Select an RSS topic or add a custom story description first.')
      return
    }
    if (storyDescription.trim().length > STORY_DESCRIPTION_MAX) {
      setError(`storyDescription: Please keep this under ${STORY_DESCRIPTION_MAX} characters.`)
      return
    }

    const result = await runStep('Generating draft...', () =>
      callAiCompose<{
        draft: Draft
        sourceRssTopic: string | null
        evaluation: DraftEvaluation
        useHumorPerspectiveMethod?: boolean
      }>({
        action: 'generateDraft',
        rssTopic: rssTopic.trim() || undefined,
        storyDescription: storyDescription.trim() || undefined,
        revisionInstructions: draftFeedback.trim() || undefined,
        previousDrafts: draftHistory,
        options: generationOptions,
      }),
    )

    if (!result) return

    const nextDraft: Draft = {
      headline: result.draft.headline,
      subheadline: result.draft.subheadline ?? null,
      excerpt: result.draft.excerpt ?? null,
    }

    setDraftResult({
      draft: nextDraft,
      sourceRssTopic: result.sourceRssTopic,
      evaluation: result.evaluation,
      useHumorPerspectiveMethod: result.useHumorPerspectiveMethod,
    })
    setDraftHistory((prev) => [...prev, nextDraft])
    resetDownstreamFromDraft()
  }

  async function onGenerateArticle() {
    if (!draftResult || !draftApproved) {
      setError('Approve a draft before generating the full article.')
      return
    }
    if (storyDescription.trim().length > STORY_DESCRIPTION_MAX) {
      setError(`storyDescription: Please keep this under ${STORY_DESCRIPTION_MAX} characters.`)
      return
    }

    const result = await runStep('Generating article...', () =>
      callAiCompose<{
        article: GeneratedArticle
        usedRssTopic: string | null
      }>({
        action: 'generateArticle',
        approvedDraft: draftResult.draft,
        sourceRssTopic: draftResult.sourceRssTopic,
        rssTopic: rssTopic.trim() || undefined,
        storyDescription: storyDescription.trim() || undefined,
        revisionInstructions: articleFeedback.trim() || undefined,
        useHumorPerspectiveMethod: draftResult.useHumorPerspectiveMethod,
        options: generationOptions,
      }),
    )

    if (!result) return

    setArticle(result.article)
    setUsedRssTopic(result.usedRssTopic ?? draftResult.sourceRssTopic ?? null)
    setIsManualArticle(false)
    setArticleApproved(false)
    setImagePrompt(result.article.imagePrompt?.trim() ?? '')
    setImageUrl(null)
    setImageApproved(false)
    setPublishResult(null)
  }

  async function onGenerateImage() {
    if (!article || !articleApproved) {
      setError('Approve the article before generating an image.')
      return
    }

    if (!imagePrompt.trim()) {
      setError('Add an image prompt before generating the image.')
      return
    }

    const result = await runStep('Generating image...', () =>
      callAiCompose<{
        imageUrl: string
        promptUsed: string
      }>({
        action: 'generateImage',
        headline: article.headline,
        imagePrompt: imagePrompt.trim(),
        revisionInstructions: imageFeedback.trim() || undefined,
      }),
    )

    if (!result) return

    setImageUrl(result.imageUrl)
    setImageApproved(false)
    setPublishResult(null)
  }

  async function onPublish() {
    if (!article || !articleApproved) {
      setError('Approve the article before publishing.')
      return
    }

    if (!imageUrl || !imageApproved) {
      setError('Approve the image before publishing.')
      return
    }
    if (storyDescription.trim().length > STORY_DESCRIPTION_MAX) {
      setError(`storyDescription: Please keep this under ${STORY_DESCRIPTION_MAX} characters.`)
      return
    }

    const result = await runStep('Publishing article...', () =>
      callAiCompose<PublishResult>({
        action: 'publish',
        article,
        featuredImageUrl: imageUrl,
        sourceRssTopic: usedRssTopic ?? draftResult?.sourceRssTopic ?? null,
        rssTopic: rssTopic.trim() || undefined,
        storyDescription: storyDescription.trim() || undefined,
        setAsHeadline,
        manualArticle: isManualArticle,
      }),
    )

    if (!result) return

    setPublishResult(result)
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 40px' }}>
      <h1 style={{ fontSize: 30, marginBottom: 6 }}>AI Compose</h1>
      <p style={{ marginTop: 0, marginBottom: 10, color: 'var(--theme-elevation-600)' }}>
        Topic or prompt {'->'} draft approval {'->'} article approval {'->'} image approval {'->'}{' '}
        publish
      </p>
      <div style={{ marginBottom: 18 }}>
        <Link href="/admin" style={{ color: 'var(--theme-text)', textDecoration: 'underline' }}>
          {'<-'} Back to Admin
        </Link>
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 16,
            border: '1px solid #f6b0b0',
            background: '#fff5f5',
            color: '#a30000',
            padding: '10px 12px',
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      ) : null}

      {working ? (
        <div
          style={{
            marginBottom: 16,
            border: '1px solid var(--theme-elevation-200)',
            background: 'var(--theme-elevation-50)',
            padding: '10px 12px',
            borderRadius: 6,
          }}
        >
          {working}
        </div>
      ) : null}

      <section
        style={{ border: '1px solid var(--theme-elevation-200)', borderRadius: 8, padding: 16 }}
      >
        <h2 style={{ marginTop: 0 }}>1. Pick Topic Or Prompt</h2>

        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>RSS Topic</label>
        <select
          value={rssTopic}
          onChange={(event) => setRssTopic(event.target.value)}
          style={{ width: '100%', padding: 10, borderRadius: 6, marginBottom: 12 }}
          disabled={topicsLoading}
        >
          <option value="">No RSS topic selected</option>
          {topics.map((topic) => (
            <option key={`${topic.source}-${topic.url}`} value={topic.title}>
              [{topic.source}] {topic.title}
            </option>
          ))}
        </select>

        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
          Or describe your story idea
        </label>
        <textarea
          value={storyDescription}
          maxLength={STORY_DESCRIPTION_MAX}
          onChange={(event) => setStoryDescription(event.target.value)}
          rows={3}
          placeholder="Example: Satire about new office-return policies in Berlin startups"
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            resize: 'vertical',
          }}
        />
        <div
          style={{
            marginTop: -8,
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--theme-elevation-600)',
          }}
        >
          {storyDescription.length}/{STORY_DESCRIPTION_MAX}
        </div>

        <div
          style={{
            border: '1px solid var(--theme-elevation-200)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Generation Options</div>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={generationOptions.useRssTopic}
              onChange={(event) => updateOption('useRssTopic', event.target.checked)}
            />{' '}
            Use RSS topic input
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={generationOptions.useRandomModes}
              onChange={(event) => updateOption('useRandomModes', event.target.checked)}
            />{' '}
            Use random mode variations
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={generationOptions.includeBerlinThemes}
              onChange={(event) => updateOption('includeBerlinThemes', event.target.checked)}
            />{' '}
            Include Berlin/Wedding themes
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={generationOptions.strictTopicFocus}
              onChange={(event) => updateOption('strictTopicFocus', event.target.checked)}
            />{' '}
            Enforce strict topic in headline/opening
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={generationOptions.forceDrugsTechno}
              onChange={(event) => updateOption('forceDrugsTechno', event.target.checked)}
            />{' '}
            Force drugs/techno angle
          </label>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={generationOptions.forceStartup}
              onChange={(event) => updateOption('forceStartup', event.target.checked)}
            />{' '}
            Force startup/gentrification angle
          </label>
          <label style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={generationOptions.forceOpinion}
              onChange={(event) => updateOption('forceOpinion', event.target.checked)}
            />{' '}
            Force opinion format
          </label>
        </div>

        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
          Draft feedback (optional)
        </label>
        <textarea
          value={draftFeedback}
          onChange={(event) => setDraftFeedback(event.target.value)}
          rows={3}
          placeholder="If regenerating: tell the model what to change in the draft"
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            resize: 'vertical',
          }}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onGenerateDraft}
            disabled={Boolean(working) || !hasTopicInput}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Generate Draft
          </button>
          <button
            type="button"
            onClick={onStartManualDraft}
            disabled={Boolean(working)}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Start Manual Draft
          </button>
        </div>
      </section>

      <section
        style={{
          border: '1px solid var(--theme-elevation-200)',
          borderRadius: 8,
          padding: 16,
          marginTop: 14,
        }}
      >
        <h2 style={{ marginTop: 0 }}>2. Draft Approval</h2>
        {!draftResult ? (
          <p style={{ color: 'var(--theme-elevation-600)' }}>
            Generate a draft or start a manual draft to continue.
          </p>
        ) : (
          <>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Headline</label>
            <input
              value={draftResult.draft.headline}
              onChange={(event) => onUpdateDraftField('headline', event.target.value)}
              style={{ width: '100%', padding: 10, borderRadius: 6, marginBottom: 10 }}
              placeholder="Write or edit the headline"
            />
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Subheadline
            </label>
            <textarea
              value={draftResult.draft.subheadline ?? ''}
              onChange={(event) =>
                onUpdateDraftField('subheadline', toNullable(event.target.value))
              }
              rows={2}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 6,
                marginBottom: 10,
                resize: 'vertical',
              }}
              placeholder="Optional subheadline"
            />
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Excerpt</label>
            <textarea
              value={draftResult.draft.excerpt ?? ''}
              onChange={(event) => onUpdateDraftField('excerpt', toNullable(event.target.value))}
              rows={3}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 6,
                marginBottom: 10,
                resize: 'vertical',
              }}
              placeholder="Optional excerpt"
            />

            <div style={{ fontSize: 13, color: 'var(--theme-elevation-700)', marginBottom: 12 }}>
              <strong>Auto evaluation:</strong>{' '}
              {draftResult.evaluation.accepted ? 'Pass' : 'Needs work'} |{' '}
              {draftResult.evaluation.reason}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={onApproveDraft}
                disabled={Boolean(working)}
                style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
              >
                Approve Draft
              </button>
              <button
                type="button"
                onClick={onGenerateDraft}
                disabled={Boolean(working) || !hasTopicInput}
                style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
              >
                Regenerate Draft
              </button>
            </div>
            {draftApproved ? (
              <div style={{ marginTop: 10, color: '#0a6f2f', fontWeight: 600 }}>
                Draft approved.
              </div>
            ) : null}
          </>
        )}
      </section>

      <section
        style={{
          border: '1px solid var(--theme-elevation-200)',
          borderRadius: 8,
          padding: 16,
          marginTop: 14,
          opacity: draftApproved ? 1 : 0.7,
        }}
      >
        <h2 style={{ marginTop: 0 }}>3. Article Approval</h2>
        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
          Article feedback (optional)
        </label>
        <textarea
          value={articleFeedback}
          onChange={(event) => setArticleFeedback(event.target.value)}
          rows={3}
          placeholder="If regenerating: tell the model what to change in the article"
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            resize: 'vertical',
          }}
          disabled={!draftApproved}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            type="button"
            onClick={onGenerateArticle}
            disabled={Boolean(working) || !draftApproved}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Generate Article
          </button>
          <button
            type="button"
            onClick={onGenerateArticle}
            disabled={Boolean(working) || !draftApproved || !article}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Regenerate Article
          </button>
          <button
            type="button"
            onClick={onStartManualArticle}
            disabled={Boolean(working) || !draftApproved}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Start Manual Article
          </button>
          <button
            type="button"
            onClick={onApproveArticle}
            disabled={Boolean(working) || !article}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Approve Article
          </button>
        </div>

        {!article ? (
          <p style={{ color: 'var(--theme-elevation-600)' }}>
            Approve a draft and generate the article to continue.
          </p>
        ) : (
          <>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Headline</label>
            <input
              value={article.headline}
              onChange={(event) => onUpdateArticleField('headline', event.target.value)}
              style={{ width: '100%', padding: 10, borderRadius: 6, marginBottom: 10 }}
            />
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Subheadline
            </label>
            <textarea
              value={article.subheadline ?? ''}
              onChange={(event) =>
                onUpdateArticleField('subheadline', toNullable(event.target.value))
              }
              rows={2}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 6,
                marginBottom: 10,
                resize: 'vertical',
              }}
            />
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Excerpt</label>
            <textarea
              value={article.excerpt ?? ''}
              onChange={(event) => onUpdateArticleField('excerpt', toNullable(event.target.value))}
              rows={3}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 6,
                marginBottom: 10,
                resize: 'vertical',
              }}
            />
            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
                  Category slug
                </label>
                <input
                  value={article.categorySlug}
                  onChange={(event) => onUpdateArticleField('categorySlug', event.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 6 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
                  Author slug
                </label>
                <input
                  value={article.authorSlug}
                  onChange={(event) => onUpdateArticleField('authorSlug', event.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 6 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Layout</label>
                <select
                  value={article.layout}
                  onChange={(event) =>
                    onUpdateArticleField('layout', event.target.value as GeneratedArticle['layout'])
                  }
                  style={{ width: '100%', padding: 10, borderRadius: 6 }}
                >
                  <option value="standard">standard</option>
                  <option value="wide">wide</option>
                  <option value="opinion">opinion</option>
                </select>
              </div>
            </div>
            <div
              style={{
                marginTop: 10,
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
                  New author name (optional)
                </label>
                <input
                  value={article.newAuthorName ?? ''}
                  onChange={(event) =>
                    onUpdateArticleField('newAuthorName', toNullable(event.target.value))
                  }
                  style={{ width: '100%', padding: 10, borderRadius: 6 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
                  New author title (optional)
                </label>
                <input
                  value={article.newAuthorTitle ?? ''}
                  onChange={(event) =>
                    onUpdateArticleField('newAuthorTitle', toNullable(event.target.value))
                  }
                  style={{ width: '100%', padding: 10, borderRadius: 6 }}
                />
              </div>
            </div>
            <label style={{ display: 'block', marginTop: 10, marginBottom: 6, fontWeight: 600 }}>
              New author bio (optional)
            </label>
            <textarea
              value={article.newAuthorBio ?? ''}
              onChange={(event) =>
                onUpdateArticleField('newAuthorBio', toNullable(event.target.value))
              }
              rows={3}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 6,
                marginBottom: 10,
                resize: 'vertical',
              }}
            />
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Image caption (optional)
            </label>
            <input
              value={article.imageCaption ?? ''}
              onChange={(event) =>
                onUpdateArticleField('imageCaption', toNullable(event.target.value))
              }
              style={{ width: '100%', padding: 10, borderRadius: 6, marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={article.isFeatured}
                  onChange={(event) => onUpdateArticleField('isFeatured', event.target.checked)}
                />
                Featured
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={article.isHeadline}
                  onChange={(event) => onUpdateArticleField('isHeadline', event.target.checked)}
                />
                Headline
              </label>
            </div>
            {usedRssTopic ? (
              <div style={{ marginBottom: 8 }}>
                <strong>Topic continuity:</strong> {usedRssTopic}
              </div>
            ) : null}
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Body</label>
            <textarea
              value={article.bodyMarkdown}
              onChange={(event) => onUpdateArticleField('bodyMarkdown', event.target.value)}
              rows={14}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 6,
                resize: 'vertical',
                marginBottom: 10,
              }}
            />
            {articleApproved ? (
              <div style={{ marginTop: 10, color: '#0a6f2f', fontWeight: 600 }}>
                Article approved.
              </div>
            ) : null}
          </>
        )}
      </section>

      <section
        style={{
          border: '1px solid var(--theme-elevation-200)',
          borderRadius: 8,
          padding: 16,
          marginTop: 14,
          opacity: articleApproved ? 1 : 0.7,
        }}
      >
        <h2 style={{ marginTop: 0 }}>4. Image Approval</h2>

        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
          Image URL override (optional)
        </label>
        <input
          value={imageUrl ?? ''}
          onChange={(event) => {
            setImageUrl(toNullable(event.target.value))
            setImageApproved(false)
            setPublishResult(null)
          }}
          placeholder="Paste your own image URL or generate one below"
          style={{ width: '100%', padding: 10, borderRadius: 6, marginBottom: 12 }}
          disabled={!articleApproved}
        />

        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Image prompt</label>
        <textarea
          value={imagePrompt}
          onChange={(event) => {
            setImagePrompt(event.target.value)
            setImageApproved(false)
            setPublishResult(null)
          }}
          rows={4}
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            resize: 'vertical',
          }}
          disabled={!articleApproved}
        />

        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
          Image feedback (optional)
        </label>
        <textarea
          value={imageFeedback}
          onChange={(event) => setImageFeedback(event.target.value)}
          rows={3}
          placeholder="If regenerating: tell the model what to change in the image"
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
            resize: 'vertical',
          }}
          disabled={!articleApproved}
        />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            type="button"
            onClick={onGenerateImage}
            disabled={Boolean(working) || !articleApproved || !imagePrompt.trim()}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Generate Image
          </button>
          <button
            type="button"
            onClick={() => setImageApproved(true)}
            disabled={Boolean(working) || !imageUrl}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Approve Image
          </button>
        </div>

        {imageUrl ? (
          <div>
            <Image
              src={imageUrl}
              alt="Generated preview"
              width={1024}
              height={1024}
              unoptimized
              style={{
                width: 360,
                maxWidth: '100%',
                height: 'auto',
                borderRadius: 8,
                border: '1px solid var(--theme-elevation-200)',
              }}
            />
            {imageApproved ? (
              <div style={{ marginTop: 10, color: '#0a6f2f', fontWeight: 600 }}>
                Image approved.
              </div>
            ) : null}
          </div>
        ) : (
          <p style={{ color: 'var(--theme-elevation-600)' }}>
            Approve the article, then generate or paste an image URL and approve the image.
          </p>
        )}
      </section>

      <section
        style={{
          border: '1px solid var(--theme-elevation-200)',
          borderRadius: 8,
          padding: 16,
          marginTop: 14,
          opacity: imageApproved ? 1 : 0.7,
        }}
      >
        <h2 style={{ marginTop: 0 }}>5. Publish</h2>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={setAsHeadline}
            onChange={(event) => setSetAsHeadline(event.target.checked)}
            disabled={!imageApproved}
          />
          Set as headline (respects generated `isHeadline` flag)
        </label>

        <div>
          <button
            type="button"
            onClick={onPublish}
            disabled={Boolean(working) || !imageApproved}
            style={{ padding: '10px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            Publish Article
          </button>
        </div>

        {publishResult ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, color: '#0a6f2f' }}>Published successfully.</div>
            <div>
              <strong>Slug:</strong> {publishResult.created.slug}
            </div>
            <div>
              <strong>URL:</strong>{' '}
              <a href={publishResult.created.url} target="_blank" rel="noreferrer">
                {publishResult.created.url}
              </a>
            </div>
            <div>
              <strong>Revalidated:</strong> {publishResult.revalidatedPaths.join(', ')}
            </div>
            {publishResult.instagram ? (
              <div>
                <strong>Instagram:</strong>{' '}
                {publishResult.instagram.queuedByArticleHook
                  ? 'queued by article publish hook'
                  : publishResult.instagram.attempted
                    ? publishResult.instagram.skipped
                      ? `skipped (${publishResult.instagram.reason ?? 'unknown reason'})`
                      : 'posted'
                    : `skipped (${publishResult.instagram.reason ?? 'disabled'})`}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
