import { describe, expect, it } from 'vitest'
import {
  assertArticleLanguagePolicy,
  assessHeadlineLanguage,
  assessSupportingTextLanguage,
  assertHeadlineLanguagePolicy,
} from './headlineLanguage'

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
    'DU ARSCHLOCH, JETZT BITTE MIT APPLAUS',
    'LEIHFAHRRÄDER, PARKE, DANN SCHÄM DICH',
    'VOM HAUSEINGANG AUF DIE STREAMING-PRIVATJET-LISTE',
    '„ICH FÜRCHTE AM MEISTEN MEINEN VATER“',
    'ÄRZTE STREIKEN HEUTE',
    'Schüler Protestieren Gegen Kürzungen',
  ])('rejects uppercase German-dominant production headline %s', (headline) => {
    const result = assessHeadlineLanguage(headline)

    expect(result.passes).toBe(false)
    expect(result.reason).toContain('headline-language:')
  })

  it.each([
    'Ashtray Diplomacy at the Bürgeramt',
    'Späti Etiquette Meets Bürgeramt Logic at Midnight',
    '‘Bitte warten’ at the Hospital',
    "'Bitte warten' at the Hospital",
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

  it('rejects a German clause whose known evidence surrounds unknown vocabulary', () => {
    const result = assessHeadlineLanguage('Die Leute warten at the Hospital')

    expect(result.passes).toBe(false)
    expect(result.signals).toContain('unquoted-german-clause')
  })

  it.each([
    'Die Kinder warten at the Hospital',
    'Die Frauen warten at the Hospital',
    'Du siehst Leute at the Hospital',
  ])('rejects structurally German clauses with unseen vocabulary %s', (headline) => {
    const result = assessHeadlineLanguage(headline)

    expect(result.passes).toBe(false)
    expect(result.signals).toContain('unquoted-german-clause')
  })

  it('allows two isolated German terms separated by an unknown English word', () => {
    const result = assessHeadlineLanguage('Döner Delights Anmeldung at the Hospital')

    expect(result.englishShare).toBe(0.6)
    expect(result.passes).toBe(true)
  })

  it('keeps local German terms classified before title-cased entity heuristics', () => {
    const result = assessHeadlineLanguage('Döner Etiquette Meets Anmeldung Logic at Midnight')

    expect(result.germanWordCount).toBe(2)
    expect(result.passes).toBe(true)
  })

  it.each([
    'Kitchen Chaos Hits Berlin',
    'Müller Opens Berlin Clinic',
    'The Hospital Expands From München to Köln',
    '‘Bitte warten’ at the Zürich Hospital',
    'Samsung Opens Berlin Lab',
    'Zürich Clinic Expands',
    'Samsung Announces Berlin Lab',
  ])('does not treat English suffix collisions or named entities as German in %s', (headline) => {
    expect(assessHeadlineLanguage(headline).passes).toBe(true)
  })

  it.each(['The die is cast', 'Die Hard Returns to Berlin'])(
    'counts contextual English die correctly in headline %s',
    (headline) => {
      const result = assessHeadlineLanguage(headline)

      expect(result.passes).toBe(true)
      expect(result.germanWordCount).toBe(0)
    },
  )

  it('does not pair possessive and contraction apostrophes as quotation marks', () => {
    const result = assessHeadlineLanguage("Berlin's Späti Isn't Bürgeramt Logic at Midnight")

    expect(result.passes).toBe(true)
    expect(result.germanQuoteCount).toBe(0)
    expect(result.isolatedGermanWordCount).toBe(2)
  })

  it('supports bounded German phrases in guillemets', () => {
    expect(assessHeadlineLanguage('»Bitte warten« at the Hospital').passes).toBe(true)
  })

  it('normalizes decomposed Unicode before classifying words', () => {
    const nfc = 'für über Tür at the Hospital'
    const nfd = nfc.normalize('NFD')
    const nfcResult = assessHeadlineLanguage(nfc)
    const nfdResult = assessHeadlineLanguage(nfd)

    expect(nfcResult.passes).toBe(false)
    expect(nfdResult.passes).toBe(false)
    expect(nfdResult.englishShare).toBe(nfcResult.englishShare)
    expect(nfdResult.germanWordCount).toBe(nfcResult.germanWordCount)
  })

  it('throws the publication guard prefix for an invalid headline', () => {
    expect(() => assertHeadlineLanguagePolicy('Du Arschloch, jetzt bitte mit Applaus')).toThrow(
      'HEADLINE_LANGUAGE_GUARD:',
    )
  })

  it('rejects classified German words in supporting text', () => {
    const result = assessSupportingTextLanguage('The crowd says bitte warten.')

    expect(result.passes).toBe(false)
    expect(result.reason).toContain('headline-language:')
  })

  it.each([
    'The die is cast.',
    'Die Hard is a film.',
    'Samsung opens a Berlin lab.',
    'Zürich clinic expands.',
    'The La La Land premiere opens.',
  ])('allows contextual English words and named entities in supporting text %s', (text) => {
    expect(assessSupportingTextLanguage(text).passes).toBe(true)
  })

  it('does not ignore lowercase German homographs outside English context', () => {
    const result = assessSupportingTextLanguage('Patients see die crowd.')

    expect(result.passes).toBe(false)
    expect(result.reason).toContain('headline-language:')
  })

  it.each([
    {
      field: 'headline',
      article: {
        headline: 'DU ARSCHLOCH, JETZT BITTE MIT APPLAUS',
        subheadline: 'The hospital turns waiting into public policy.',
        excerpt: 'Patients discover that patience is now an administrative requirement.',
      },
    },
    {
      field: 'subheadline',
      article: {
        headline: 'Hospital Queue Turns Patience Into Policy',
        subheadline: 'Patients say bitte while the hospital closes another desk.',
        excerpt: 'Patients discover that patience is now an administrative requirement.',
      },
    },
    {
      field: 'excerpt',
      article: {
        headline: 'Hospital Queue Turns Patience Into Policy',
        subheadline: 'The hospital turns waiting into public policy.',
        excerpt: 'Patients say bitte while the hospital closes another desk.',
      },
    },
  ])('guards the finalized article $field', ({ field, article }) => {
    expect(() => assertArticleLanguagePolicy(article)).toThrow(`HEADLINE_LANGUAGE_GUARD: ${field}`)
  })
})
