export type SlotConfig = {
  forceDrugsTechno: boolean | undefined
  forceStartup: boolean | undefined
  forceRss: boolean | undefined
  /** Force the fictional Alternativ für Ratten political-satire mode. */
  forceAfR?: boolean
  forceOpinion: boolean
  includeTopics: boolean
  /** One slot-level roll shared by draft and article prompts. */
  useHumorPerspectiveMethod?: boolean
  /** Planner bucket used for observability and editorial steering. */
  themeBucket?: string
  /** Slot-level editor instruction used by draft generation. */
  editorDirection?: string
}

export type RecentCoverageItem = {
  headline: string
  excerpt: string
  categorySlug?: string | null
  sourceRssTopic?: string | null
}

export type DraftCandidate = {
  headline: string
  subheadline: string | null
  excerpt: string | null
}

export type DraftEvaluation = {
  accepted: boolean
  /** True only when the draft cleared every non-tone safety/quality gate and contains no meta-commentary. */
  safeForFallback: boolean
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
    conceptualInnuendoPass: boolean
    metaCommentaryPass: boolean
    languagePass: boolean
    englishShare: number
    germanUsageSummary: string
    pass: boolean
    reason: string
  }
}
