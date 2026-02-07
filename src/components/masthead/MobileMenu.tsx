'use client'

import React from 'react'
import Link from 'next/link'
import { CloseIcon } from './icons'

interface MobileMenuProps {
  isOpen: boolean
  onClose: () => void
}

const mobileMenuCategories = [
  { name: 'Bureaucracy', slug: 'bureaucracy' },
  { name: 'Leopoldplatz', slug: 'leopoldplatz' },
  { name: 'Nightlife', slug: 'nightlife' },
  { name: 'Opinion', slug: 'opinion' },
  { name: 'Doener & Drinks', slug: 'food-drink' },
  { name: 'Crime', slug: 'crime' },
  { name: 'Techno', slug: 'techno' },
  { name: 'Kiez News', slug: 'kiez' },
]

export const MobileMenu: React.FC<MobileMenuProps> = React.memo(function MobileMenu({
  isOpen,
  onClose,
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-white z-[9998] overflow-y-auto">
      <div className="p-5">
        <div className="flex justify-between items-center mb-8">
          <span className="font-masthead text-2xl">The Wedding Times</span>
          <button
            onClick={onClose}
            className="bg-transparent border-none cursor-pointer p-2"
            type="button"
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>
        <nav>
          {mobileMenuCategories.map((category) => (
            <Link
              key={category.slug}
              href={`/section/${category.slug}`}
              onClick={onClose}
              className="block font-sans text-lg font-semibold py-4 border-b border-[#e2e2e2] text-[#121212]"
            >
              {category.name}
            </Link>
          ))}
          <Link
            href="/archive"
            onClick={onClose}
            className="block font-sans text-lg font-semibold py-4 border-b border-[#e2e2e2] text-[#121212]"
          >
            Archive
          </Link>
        </nav>
      </div>
    </div>
  )
})
