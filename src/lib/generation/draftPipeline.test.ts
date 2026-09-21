import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateDraftCandidate, generateDraftCandidate } from './draftPipeline'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(() => ({
    invoke: mocks.invoke,
  })),
}))

describe('generateDraftCandidate', () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey
    mocks.invoke.mockReset()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('treats configured RSS source tags as RSS topics for forced RSS slots', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Senate Discovers a Queue With Feelings',
        subheadline: 'A procedural scandal becomes a civic personality test.',
        excerpt: 'Officials insist the queue is temporary, despite giving it a desk.',
      }),
    })

    const result = await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: true,
        forceOpinion: false,
        includeTopics: true,
      },
      topicSummary: '- [nytimes] Senate discovers the queue is sentient',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      forbiddenSourceTopics: [],
      useRandomModes: false,
    })

    expect(result.sourceRssTopic).toBe('Senate discovers the queue is sentient')
    expect(mocks.invoke).toHaveBeenCalledOnce()
    expect(JSON.stringify(mocks.invoke.mock.calls[0]?.[0])).toContain(
      'Assigned topic/news hook: Senate discovers the queue is sentient',
    )
  })

  it('grounds an ambiguous officeholder headline in dated source metadata instead of model memory', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T10:00:00.000Z'))
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<html><head><meta property="og:description" content="Politologe erklärt, was das Wahldebakel für Friedrich Merz und die Koalition bedeutet."></head></html>',
            { status: 200, headers: { 'content-type': 'text/html' } },
          ),
      ),
    )
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Merz Finds the Chancellery Exit Locked From Inside',
        subheadline: 'The coalition rehearses loyalty while checking every emergency door.',
        excerpt: 'A disastrous election result turns the chancellery into a public waiting room.',
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
      topicSummary:
        '- [berliner-zeitung] Politologe: Mit einem spontanen Rücktritt des Bundeskanzlers habe ich nicht gerechnet',
      rssTopics: [
        {
          source: 'berliner-zeitung',
          title:
            'Politologe: Mit einem spontanen Rücktritt des Bundeskanzlers habe ich nicht gerechnet',
          url: 'https://www.berliner-zeitung.de/article/merz-interview',
          publishedAt: '2026-09-21T06:00:00.000Z',
        },
      ],
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      forbiddenSourceTopics: [],
      useRandomModes: false,
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toContain('Current date in Europe/Berlin: 2026-09-21')
    expect(combined).toContain('Friedrich Merz')
    expect(combined).toContain('Published: 2026-09-21T06:00:00.000Z')
    expect(combined).toMatch(/never infer.*officeholder.*model memory/i)
    expect(combined).toMatch(
      /source.*does not identify.*use the office title.*do not invent a name/i,
    )
  })

  it('activates explicit AfR pitch mode for a forced AfR slot', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Rat Party Demands Heritage Status for Sewer Borders',
        subheadline: 'Alice Rattenweidel promises purity checks beneath the central sewer.',
        excerpt: 'The fictional AfR turns a blocked drain into a nationalist emergency.',
      }),
    })

    await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: false,
        forceAfR: true,
        forceOpinion: false,
        includeTopics: false,
      },
      topicSummary: '- [nytimes] An unrelated current-news topic',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      useRandomModes: false,
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toContain(
      'Mode: This pitch must center the fictional far-right rat party Alternativ für Ratten (AfR)',
    )
    expect(combined).toContain('No fixed topic: choose a fresh one.')
  })

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
    expect(combined).toContain(
      'Proper names, place names, acronyms, numbers, and punctuation are excluded from the denominator',
    )
    expect(combined.indexOf('HEADLINE LANGUAGE POLICY')).toBeLessThan(
      combined.indexOf('Assigned topic/news hook'),
    )
  })

  it('requires the pitch headline to carry the story’s conceptual sexual double meaning', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Bürgeramt Promises a Firmer Grip on Every Application',
        subheadline: 'The office turns administrative control into an intimacy problem.',
        excerpt: 'Officials insist the new procedure is satisfying once residents submit.',
      }),
    })

    await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: false,
        forceOpinion: false,
        includeTopics: false,
      },
      topicSummary: '',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      useRandomModes: false,
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toMatch(/sexual double meaning.*(?:premise|comedic engine)/i)
    expect(combined).toMatch(/headline.*(?:carry|express).*(?:same|central).*double meaning/i)
    expect(combined).toMatch(/not.*(?:dirty words|suggestive phrases|word-count quota)/i)
    expect(combined).toContain('NEVER BREAK THE FOURTH WALL')
    expect(combined).toMatch(/headline, subheadline, excerpt.*reader.*infer/i)
  })

  it('strongly prefers an organic cultural allusion in batch-generated headlines', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Bürgeramt Stages Its Own Waiting for Godot',
        subheadline: 'Applicants are told the missing appointment is the point.',
        excerpt: 'The office turns administrative delay into an ensemble performance.',
      }),
    })

    await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: false,
        forceOpinion: false,
        includeTopics: false,
      },
      topicSummary: '',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      useRandomModes: false,
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toMatch(
      /strongly prefer[\s\S]*headline[\s\S]*(?:cultural|recognizable)[\s\S]*allusion/i,
    )
    expect(combined).toMatch(/not mandatory|never force/i)
    expect(combined).toMatch(/do not.*(?:obscure|hide).*story subject/i)
    expect(combined).toMatch(
      /literature[\s\S]*mythology[\s\S]*film[\s\S]*television[\s\S]*music[\s\S]*visual art[\s\S]*internet culture[\s\S]*public figures/i,
    )
    expect(combined).toMatch(
      /avoid[\s\S]*Kafka[\s\S]*Sisyphus[\s\S]*Proust[\s\S]*Orwell[\s\S]*Berghain/i,
    )
  })

  it('uses the previous rejection as corrective guidance for the next draft', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        headline: 'Permit Office Demands a More Convincing Submission',
        subheadline: 'Applicants discover that compliance is the only intimacy on offer.',
        excerpt: 'The revised process makes administrative control the governing double meaning.',
      }),
    })

    await generateDraftCandidate({
      slot: {
        forceDrugsTechno: false,
        forceStartup: false,
        forceRss: false,
        forceOpinion: false,
        includeTopics: false,
      },
      topicSummary: '',
      recentCoverage: [],
      blacklistSummary: '',
      acceptedDrafts: [],
      previousAttempt: {
        draft: {
          headline: 'Permit Office Makes It Personal',
          subheadline: 'Applicants face another interview.',
          excerpt: 'The office asks for more paperwork.',
        },
        rejectionReason:
          'The sexual double meaning is decorative and disconnected from the power dynamic.',
      },
      useRandomModes: false,
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toContain('Permit Office Makes It Personal')
    expect(combined).toContain(
      'The sexual double meaning is decorative and disconnected from the power dynamic.',
    )
    expect(combined).toMatch(/correct.*previous.*rejection/i)
  })

  it('makes conceptual headline innuendo part of draft tone evaluation', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        conceptualInnuendoPass: true,
        metaCommentaryPass: true,
        languagePass: true,
        englishShare: 1,
        germanUsageSummary: '',
        pass: true,
        reason: 'Accepted.',
      }),
    })

    await evaluateDraftCandidate({
      candidate: {
        headline: 'Bürgeramt Promises a Firmer Grip on Every Application',
        subheadline: 'The office turns administrative control into an intimacy problem.',
        excerpt: 'Officials insist the new procedure is satisfying once residents submit.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    const messages = mocks.invoke.mock.calls[0]?.[0] as Array<{ content: string }>
    const combined = messages.map((message) => message.content).join('\n')

    expect(combined).toMatch(/headline.*conceptual sexual double meaning/i)
    expect(combined).toMatch(
      /headline, subheadline, and excerpt.*one coherent.*(?:mechanism|concept)/i,
    )
    expect(combined).toMatch(/(?:reject|pass=false).*merely.*(?:dirty word|suggestive phrase)/i)
    expect(combined).toMatch(/three-field pitch.*not.*finished article/i)
    expect(combined).toMatch(/do not demand.*(?:ending|full article arc)/i)
    expect(combined).toContain('NEVER BREAK THE FOURTH WALL')
    expect(combined).toMatch(/pass=false.*meta-commentary/i)
  })

  it('allows a non-meta tone rejection to become a final safe fallback', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 6,
        mercilessScore: 7,
        specificityScore: 6,
        conceptualInnuendoPass: false,
        metaCommentaryPass: true,
        pass: false,
        reason: 'The double meaning is recognizable but not yet central enough.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Lie Back for the Permit at the Housing Desk',
        subheadline: 'Applicants discover that submission is the only route to approval.',
        excerpt: 'The housing office turns paperwork and bodily compliance into the same ritual.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.safeForFallback).toBe(true)
  })

  it('never allows meta-commentary to become a final safe fallback', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 9,
        mercilessScore: 9,
        specificityScore: 9,
        conceptualInnuendoPass: true,
        metaCommentaryPass: false,
        pass: false,
        reason: 'The excerpt explains that the piece is satire.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Permit Office Demands Firmer Submission',
        subheadline: 'Applicants discover that compliance is the only route to approval.',
        excerpt: 'This satirical piece would mock the officials who enjoy the paperwork.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.safeForFallback).toBe(false)
  })

  it('uses the deterministic English share instead of an evaluator-provided percentage', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        conceptualInnuendoPass: true,
        metaCommentaryPass: true,
        languagePass: true,
        englishShare: 66.67,
        germanUsageSummary: 'One isolated German term used.',
        pass: true,
        reason: 'Accepted.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Hospital Queue Demands Firmer Submission Before Opening',
        subheadline: 'Patients discover the waiting policy prefers those willing to submit.',
        excerpt: 'Administrators promise satisfaction once everyone accepts a firmer grip.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(true)
    expect(evaluation.tone.englishShare).toBe(1)
  })

  it('does not let a false semantic language verdict override the deterministic language gate', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        conceptualInnuendoPass: true,
        metaCommentaryPass: true,
        languagePass: false,
        englishShare: 0.67,
        germanUsageSummary: 'No German terms or phrases used.',
        pass: true,
        reason: 'The pitch is sharp, coherent, and contains no meta-commentary.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Trash Can Consent, Wedding’s New Courtyard Sport',
        subheadline:
          'A new building rule makes residents ask permission before using the shared bins.',
        excerpt:
          'Property managers turn every bag of trash into a test of manners, class loyalty, and who gets to act offended first.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(true)
    expect(evaluation.tone.languagePass).toBe(true)
    expect(evaluation.tone.englishShare).toBe(1)
    expect(evaluation.tone.germanUsageSummary).toBe('Deterministic language gate passed.')
  })

  it('logs evaluator parse failures before using the fail-closed fallback', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 'eight',
        mercilessScore: 8,
        specificityScore: 8,
        conceptualInnuendoPass: true,
        metaCommentaryPass: true,
        languagePass: true,
        englishShare: 'sixty-seven percent',
        germanUsageSummary: '',
        pass: true,
        reason: 'Accepted.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Hospital Queue Demands Firmer Submission Before Opening',
        subheadline: 'Patients discover the waiting policy prefers those willing to submit.',
        excerpt: 'Administrators promise satisfaction once everyone accepts a firmer grip.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      '[DRAFT-PIPELINE] Tone evaluator failed',
      expect.stringContaining('funScore'),
    )
    warn.mockRestore()
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

  it('does not let evaluator outage fallback override an uppercase deterministic rejection', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockRejectedValue(new Error('evaluator unavailable'))

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'DU ARSCHLOCH, JETZT BITTE MIT APPLAUS',
        subheadline: 'The campaign packages brutality as authenticity.',
        excerpt: 'The crowd mistakes bullying for courage.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('headline-language:')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('keeps a deterministically clean draft safe for fallback when the evaluator is unavailable', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockRejectedValue(new Error('evaluator unavailable'))

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: '“We’re Not Solid” — Bayern Leaves Union Open',
        subheadline:
          'After the humiliation, Union’s defenders sounded like men explaining a bad night they could still feel in their ankles.',
        excerpt:
          'The postmatch quotes read like status panic in cleats while everyone blamed somebody else for the collapse.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.safeForFallback).toBe(true)
    expect(evaluation.reason).toContain('tone:')
    expect(evaluation.tone.languagePass).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledOnce()
  })

  it('keeps explicit meta-commentary unsafe when the evaluator is unavailable', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockRejectedValue(new Error('evaluator unavailable'))

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Permit Office Demands Firmer Submission',
        subheadline: 'Applicants discover that compliance is the only route to approval.',
        excerpt:
          'This piece would satirize officials who enjoy making residents beg for paperwork.',
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.safeForFallback).toBe(false)
    expect(evaluation.tone.metaCommentaryPass).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('fails closed when the semantic tone evaluator is unavailable', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockRejectedValue(new Error('evaluator unavailable'))

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
    expect(evaluation.tone.reason).toContain('evaluator unavailable')
  })

  it.each([
    {
      field: 'subheadline',
      subheadline: 'Die crowd packages brutality as authenticity.',
      excerpt: 'Campaigners hope the crowd mistakes bullying for courage.',
    },
    {
      field: 'excerpt',
      subheadline: 'Campaigners package brutality as authenticity.',
      excerpt: 'Die crowd mistakes bullying for courage.',
    },
  ])('rejects a German $field before invoking the tone evaluator', async (candidate) => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.invoke.mockResolvedValue({
      content: JSON.stringify({
        funScore: 8,
        mercilessScore: 8,
        specificityScore: 8,
        conceptualInnuendoPass: true,
        metaCommentaryPass: true,
        languagePass: true,
        englishShare: 1,
        germanUsageSummary: '',
        pass: true,
        reason: 'Accepted.',
      }),
    })

    const evaluation = await evaluateDraftCandidate({
      candidate: {
        headline: 'Ashtray Diplomacy Controls the Night Shift',
        subheadline: candidate.subheadline,
        excerpt: candidate.excerpt,
      },
      recentCoverage: [],
      acceptedDrafts: [],
    })

    expect(evaluation.accepted).toBe(false)
    expect(evaluation.reason).toContain('headline-language:')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
