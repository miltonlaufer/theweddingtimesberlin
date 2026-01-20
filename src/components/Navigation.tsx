'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NytContainer } from './NytContainer'

/******************* ICONS ***********************/

const CaretDownIcon: React.FC = React.memo(function CaretDownIcon() {
  return (
    <svg className="w-[7px] h-[4px]" viewBox="0 0 7 4" fill="currentColor">
      <path d="M3.5 4L0 0h7L3.5 4z" />
    </svg>
  )
})

/******************* TYPES ***********************/

interface NavigationClientProps {
  categories: Array<{ name: string; slug: string }>
}

/******************* CLIENT COMPONENT ***********************/

export const NavigationClient: React.FC<NavigationClientProps> = React.memo(
  function NavigationClient({ categories }) {
    const pathname = usePathname()
    const isArticlePage = pathname.startsWith('/article/')

    if (isArticlePage) return null

    // If no categories have articles, don't render navigation
    if (categories.length === 0) return null

    return (
      <nav>
        <NytContainer>
          {/* Navigation links */}
          <div className="flex justify-center items-center gap-6 py-1.5 flex-wrap overflow-x-auto">
            {categories.map((category) => (
              <Link
                key={category.slug}
                href={`/section/${category.slug}`}
                className="font-sans text-[14px] font-medium tracking-[0.01em] text-[#121212] flex items-center gap-[5px] whitespace-nowrap leading-none"
              >
                {category.name}
                <CaretDownIcon />
              </Link>
            ))}
            <a
              href="https://github.com/miltonlaufer/theweddingtimesberlin"
              className="flex items-center leading-none"
              target="_blank"
              rel="noreferrer"
              aria-label="Source code on GitHub"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/github.svg" alt="GitHub" width={14} height={14} />
            </a>
          </div>

          {/* Double line - aligned with content columns */}
          <div className="double-rule mt-1" />
        </NytContainer>
      </nav>
    )
  },
)

/******************* LEGACY EXPORT (for backwards compatibility) ***********************/

// This is a simple wrapper that shows nothing - the real Navigation is NavigationServer
export const Navigation: React.FC = () => null
