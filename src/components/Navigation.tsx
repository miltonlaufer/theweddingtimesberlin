'use client'

import React, { useCallback } from 'react'
import { observer } from 'mobx-react-lite'
import Link from 'next/link'
import { useArticleStore, useUIStore } from '@/stores'

/******************* DEFAULT CATEGORIES ***********************/

const defaultCategories = [
  { id: 'bureaucracy', name: 'Bureaucracy', slug: 'bureaucracy', order: 1 },
  { id: 'reception', name: 'Reception', slug: 'reception', order: 2 },
  { id: 'nightlife', name: 'Nightlife', slug: 'nightlife', order: 3 },
  { id: 'opinion', name: 'Opinion', slug: 'opinion', order: 4 },
  { id: 'food-drink', name: 'Doener & Drinks', slug: 'food-drink', order: 5 },
  { id: 'family', name: 'Family Drama', slug: 'family', order: 6 },
  { id: 'techno', name: 'Techno', slug: 'techno', order: 7 },
  { id: 'kiez', name: 'Kiez News', slug: 'kiez', order: 8 },
  { id: 'gentrification', name: 'Gentrification', slug: 'gentrification', order: 9 },
]

/******************* CARET ICON ***********************/

const CaretIcon: React.FC = React.memo(function CaretIcon() {
  return (
    <svg
      style={{ width: '10px', height: '10px', marginLeft: '4px', opacity: 0.6 }}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
})

/******************* MAIN COMPONENT ***********************/

export const Navigation: React.FC = observer(function Navigation() {
  /******************* STORE ***********************/

  const articleStore = useArticleStore()
  const uiStore = useUIStore()

  /******************* COMPUTED ***********************/

  const categories = articleStore.sortedCategories.length > 0
    ? articleStore.sortedCategories
    : defaultCategories

  /******************* FUNCTIONS ***********************/

  const handleCategoryClick = useCallback(
    (slug: string) => {
      articleStore.setSelectedCategory(slug)
      uiStore.setActiveSection(slug)
    },
    [articleStore, uiStore]
  )

  /******************* RENDER ***********************/

  return (
    <>
      {/* Desktop Navigation - hidden on mobile */}
      <nav className="desktop-nav" style={{ padding: '0 20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
            padding: '12px 0',
            overflowX: 'auto',
          }}
        >
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/section/${category.slug}`}
              onClick={() => handleCategoryClick(category.slug)}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--color-ink)',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                padding: '4px 0',
              }}
            >
              {category.name}
              <CaretIcon />
            </Link>
          ))}
        </div>
      </nav>

      {/* Double line separator */}
      <div style={{ padding: '0 20px' }}>
        <div
          style={{
            borderTop: '1px solid var(--color-ink)',
            marginBottom: '3px',
          }}
        />
        <div
          style={{
            borderTop: '3px solid var(--color-ink)',
          }}
        />
      </div>

      {/* CSS for responsive elements */}
      <style jsx global>{`
        .desktop-nav {
          display: none;
        }
        
        @media (min-width: 768px) {
          .desktop-nav {
            display: block !important;
          }
        }
      `}</style>
    </>
  )
})
