import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHeadlineModel } from './headlineProvider'
import { ChatOpenAI } from '@langchain/openai'

vi.mock('@langchain/openai', () => ({ ChatOpenAI: vi.fn() }))

describe('headline provider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('preserves the OpenAI draft model precedence by default', () => {
    vi.stubEnv('HEADLINE_PROVIDER', '')
    vi.stubEnv('OPENAI_API_KEY', 'openai-test')
    vi.stubEnv('OPENAI_DRAFT_MODEL', 'draft-model')
    createHeadlineModel()
    expect(ChatOpenAI).toHaveBeenCalledWith({
      apiKey: 'openai-test',
      model: 'draft-model',
      temperature: 1,
    })
  })

  it('routes Grok to xAI with its own key and model', () => {
    vi.stubEnv('HEADLINE_PROVIDER', 'grok')
    vi.stubEnv('XAI_API_KEY', 'xai-test')
    vi.stubEnv('XAI_HEADLINE_MODEL', 'grok-test')
    vi.stubEnv('OPENAI_API_KEY', '')
    createHeadlineModel()
    expect(ChatOpenAI).toHaveBeenCalledWith({
      apiKey: 'xai-test',
      model: 'grok-test',
      temperature: 1,
      configuration: { baseURL: 'https://api.x.ai/v1' },
      useResponsesApi: false,
    })
  })

  it('uses a default Grok model', () => {
    vi.stubEnv('HEADLINE_PROVIDER', 'grok')
    vi.stubEnv('XAI_API_KEY', 'xai-test')
    vi.stubEnv('XAI_HEADLINE_MODEL', '')
    createHeadlineModel()
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'grok-4.20-0309-non-reasoning' }),
    )
  })

  it('fails clearly without an xAI key instead of falling back to OpenAI', () => {
    vi.stubEnv('HEADLINE_PROVIDER', 'grok')
    vi.stubEnv('XAI_API_KEY', ' ')
    expect(() => createHeadlineModel()).toThrow('Missing XAI_API_KEY')
    expect(ChatOpenAI).not.toHaveBeenCalled()
  })

  it('rejects a misspelled provider', () => {
    vi.stubEnv('HEADLINE_PROVIDER', 'groq')
    expect(() => createHeadlineModel()).toThrow('Invalid HEADLINE_PROVIDER')
  })
})
