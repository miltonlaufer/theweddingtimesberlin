import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationServer } from './NavigationServer'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
}))

vi.mock('@/lib/payload', () => ({
  getPayload: mocks.getPayload,
}))

describe('NavigationServer', () => {
  const originalNextPhase = process.env.NEXT_PHASE

  beforeEach(() => {
    process.env.NEXT_PHASE = originalNextPhase
    mocks.getPayload.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.NEXT_PHASE = originalNextPhase
    vi.restoreAllMocks()
  })

  it('does not initialize Payload while Next.js is generating static pages', async () => {
    process.env.NEXT_PHASE = 'phase-production-build'

    const ui = await NavigationServer()
    const { container } = render(ui)

    expect(mocks.getPayload).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('does not fail the page when category queries fail', async () => {
    mocks.getPayload.mockResolvedValue({
      find: vi.fn().mockRejectedValue(new Error('EMAXCONN')),
    })

    const ui = await NavigationServer()
    const { container } = render(ui)

    expect(container).toBeEmptyDOMElement()
  })
})
