import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, afterEach } from 'vitest'
import { NavigationClient } from './Navigation'
import { mockedUsePathname } from '@/test/setup'

describe('NavigationClient', () => {
  afterEach(() => {
    mockedUsePathname.mockReturnValue('/')
  })

  it('does not render on article pages', () => {
    mockedUsePathname.mockReturnValue('/article/test')
    const { container } = render(<NavigationClient categories={[{ name: 'News', slug: 'news' }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders category links for non-article pages', () => {
    mockedUsePathname.mockReturnValue('/')
    const { getByText } = render(<NavigationClient categories={[{ name: 'News', slug: 'news' }]} />)
    expect(getByText('News')).toBeInTheDocument()
    expect(getByText('News').closest('a')).toHaveAttribute('href', '/section/news')
  })
})
