'use client'

import React from 'react'
import { observer } from 'mobx-react-lite'
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

/******************* DATA ***********************/

const categories = [
  { name: 'Bureaucracy', slug: 'bureaucracy' },
  { name: 'Leopoldplatz', slug: 'leopoldplatz' },
  { name: 'Nightlife', slug: 'nightlife' },
  { name: 'Opinion', slug: 'opinion' },
  { name: 'Doener & Drinks', slug: 'food-drink' },
  { name: 'Crime', slug: 'crime' },
  { name: 'Techno', slug: 'techno' },
  { name: 'Kiez News', slug: 'kiez' },
  { name: 'Gentrification', slug: 'gentrification' },
]

/******************* MAIN COMPONENT ***********************/

export const Navigation: React.FC = observer(function Navigation() {
  const pathname = usePathname()
  const isArticlePage = pathname.startsWith('/article/')

  if (isArticlePage) return null

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
        </div>

        {/* Double line - aligned with content columns */}
        <div className="double-rule mt-1" />
      </NytContainer>
    </nav>
  )
})
