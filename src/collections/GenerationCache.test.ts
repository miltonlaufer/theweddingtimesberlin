import { describe, expect, it } from 'vitest'
import { GenerationCache } from './GenerationCache'

describe('GenerationCache access', () => {
  it('denies access through public APIs', () => {
    const access = GenerationCache.access

    expect(typeof access?.read === 'function' ? access.read({} as never) : access?.read).toBe(false)
    expect(typeof access?.create === 'function' ? access.create({} as never) : access?.create).toBe(
      false,
    )
    expect(typeof access?.update === 'function' ? access.update({} as never) : access?.update).toBe(
      false,
    )
    expect(typeof access?.delete === 'function' ? access.delete({} as never) : access?.delete).toBe(
      false,
    )
  })
})
