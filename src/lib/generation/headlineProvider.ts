import { ChatOpenAI } from '@langchain/openai'

/** Shared client for pitch creation, revision, and supporting-text shortening. */
export function createHeadlineModel(): ChatOpenAI {
  const provider = process.env.HEADLINE_PROVIDER?.trim().toLowerCase() || 'openai'
  if (provider === 'grok') {
    const apiKey = process.env.XAI_API_KEY?.trim()
    if (!apiKey) throw new Error('Missing XAI_API_KEY for Grok headline generation')
    return new ChatOpenAI({
      apiKey,
      model: process.env.XAI_HEADLINE_MODEL?.trim() || 'grok-4.20-0309-non-reasoning',
      temperature: 1,
      configuration: { baseURL: 'https://api.x.ai/v1' },
      useResponsesApi: false,
    })
  }
  if (provider !== 'openai') {
    throw new Error('Invalid HEADLINE_PROVIDER: expected openai or grok')
  }
  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model:
      process.env.OPENAI_DRAFT_MODEL ??
      process.env.OPENAI_ANALYSIS_MODEL ??
      process.env.OPENAI_MODEL ??
      'gpt-4o-mini',
    temperature: 1,
  })
}
