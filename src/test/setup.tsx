/* eslint-disable @next/next/no-img-element */
import React from 'react'
import '@testing-library/jest-dom'
import { vi } from 'vitest'

export const mockedUsePathname = vi.fn(() => '/')

vi.mock('next/navigation', () => ({
  usePathname: mockedUsePathname,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    ...rest
  }: {
    src: string | { src: string }
    alt: string
    [key: string]: unknown
  }) => {
    const resolvedSrc = typeof src === 'string' ? src : (src?.src ?? '')
    return <img src={resolvedSrc} alt={alt} {...rest} />
  },
}))
