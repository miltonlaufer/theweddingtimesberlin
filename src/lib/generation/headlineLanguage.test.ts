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
