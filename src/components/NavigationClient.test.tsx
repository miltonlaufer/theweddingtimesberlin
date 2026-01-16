import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NavigationClient } from './Navigation'
import { mockedUsePathname } from '@/test/setup'

describe('NavigationClient', () => {
  it('does not render on article pages', () => {
    mockedUsePathname.mockReturnValueOnce('/article/test')
    const { container } = render(<NavigationClient categories={[{ name: 'News', slug: 'news' }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders category links for non-article pages', () => {
    mockedUsePathname.mockReturnValueOnce('/')
    const { getByText } = render(<NavigationClient categories={[{ name: 'News', slug: 'news' }]} />)
    expect(getByText('News')).toBeInTheDocument()
    expect(getByText('News').closest('a')).toHaveAttribute('href', '/section/news')
  })
})
