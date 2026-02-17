export type SlotConfig = {
  forceDrugsTechno: boolean | undefined
  forceStartup: boolean | undefined
  forceRss: boolean | undefined
  forceOpinion: boolean
  includeTopics: boolean
}

export type RecentCoverageItem = {
  headline: string
  excerpt: string
}

export type DraftCandidate = {
  headline: string
  subheadline: string | null
  excerpt: string | null
}

export type DraftEvaluation = {
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
