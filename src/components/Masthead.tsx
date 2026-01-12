'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { observer } from 'mobx-react-lite'
import Link from 'next/link'
import { useUIStore } from '@/stores'

/******************* DRUG PRICES DATA ***********************/

const drugPrices = [
  { name: 'Weed', price: '+2.34%', isUp: true },
  { name: 'MDMA', price: '-4.12%', isUp: false },
  { name: 'Ket', price: '+8.71%', isUp: true },
  { name: 'Coke', price: '-1.89%', isUp: false },
  { name: 'Speed', price: '+5.23%', isUp: true },
  { name: 'Shrooms', price: '+12.4%', isUp: true },
]

/******************* ICONS ***********************/

const SearchIcon: React.FC<{ className?: string }> = React.memo(function SearchIcon({ className }) {
  return (
    <svg className={className} style={{ width: '18px', height: '18px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
})

const HamburgerIcon: React.FC<{ className?: string }> = React.memo(function HamburgerIcon({ className }) {
  return (
    <svg className={className} style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
})

const CloseIcon: React.FC<{ className?: string }> = React.memo(function CloseIcon({ className }) {
  return (
    <svg className={className} style={{ width: '24px', height: '24px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
})

const ArrowUpIcon: React.FC = React.memo(function ArrowUpIcon() {
  return (
    <span style={{ marginLeft: '4px', fontSize: '10px', lineHeight: 1 }}>&#9650;</span>
  )
})

const ArrowDownIcon: React.FC = React.memo(function ArrowDownIcon() {
  return (
    <span style={{ marginLeft: '4px', fontSize: '10px', lineHeight: 1 }}>&#9660;</span>
  )
})

/******************* DRUG TICKER ***********************/

const DrugTicker: React.FC = React.memo(function DrugTicker() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  /******************* EFFECTS ***********************/

  useEffect(() => {
    const interval = setInterval(() => {
      // Fade out
      setIsVisible(false)
      
      // After fade out, change drug and fade in
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % drugPrices.length)
        setIsVisible(true)
      }, 500)
    }, 4000)

    return () => clearInterval(interval)
  }, [])

  /******************* RENDER ***********************/

  const currentDrug = drugPrices[currentIndex]

  return (
    <div
      className="drug-ticker-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'var(--font-sans)',
        fontSize: '14px',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.5s ease-in-out',
      }}
    >
      <span style={{ color: 'var(--color-ink)', marginRight: '6px' }}>{currentDrug.name}</span>
      <span
        style={{
          color: currentDrug.isUp ? '#0a7c00' : '#d32f2f',
          display: 'flex',
          alignItems: 'center',
          fontWeight: 500,
        }}
      >
        {currentDrug.price}
        {currentDrug.isUp ? <ArrowUpIcon /> : <ArrowDownIcon />}
      </span>
    </div>
  )
})

/******************* SEARCH OVERLAY ***********************/

interface SearchOverlayProps {
  isOpen: boolean
  onClose: () => void
}

const SearchOverlay: React.FC<SearchOverlayProps> = React.memo(function SearchOverlay({ isOpen, onClose }) {
  const [searchQuery, setSearchQuery] = useState('')

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      console.log('Searching for:', searchQuery)
      alert(`Search functionality coming soon! You searched for: "${searchQuery}"`)
    }
  }, [searchQuery])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '120px',
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px',
        }}
        type="button"
        aria-label="Close search"
      >
        <CloseIcon />
      </button>
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '600px', padding: '0 20px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          placeholder="Search The Wedding Times..."
          autoFocus
          style={{
            width: '100%',
            fontSize: '24px',
            fontFamily: 'var(--font-sans)',
            padding: '16px 0',
            border: 'none',
            borderBottom: '2px solid var(--color-ink)',
            outline: 'none',
            background: 'transparent',
          }}
        />
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          color: 'var(--color-ink-lighter)',
          marginTop: '12px',
        }}>
          Press Enter to search
        </p>
      </form>
    </div>
  )
})

/******************* MOBILE MENU ***********************/

interface MobileMenuProps {
  isOpen: boolean
  onClose: () => void
}

const mobileMenuCategories = [
  { name: 'Bureaucracy', slug: 'bureaucracy' },
  { name: 'Reception', slug: 'reception' },
  { name: 'Nightlife', slug: 'nightlife' },
  { name: 'Opinion', slug: 'opinion' },
  { name: 'Doener & Drinks', slug: 'food-drink' },
  { name: 'Family Drama', slug: 'family' },
  { name: 'Techno', slug: 'techno' },
  { name: 'Kiez News', slug: 'kiez' },
]

const MobileMenu: React.FC<MobileMenuProps> = React.memo(function MobileMenu({ isOpen, onClose }) {
  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'white',
        zIndex: 9998,
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <span style={{ fontFamily: 'var(--font-masthead)', fontSize: '1.5rem' }}>The Wedding Times</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px' }}
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
              style={{
                display: 'block',
                fontFamily: 'var(--font-sans)',
                fontSize: '18px',
                fontWeight: 600,
                padding: '16px 0',
                borderBottom: '1px solid var(--color-rule)',
                color: 'var(--color-ink)',
              }}
            >
              {category.name}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
})

/******************* MAIN COMPONENT ***********************/

export const Masthead: React.FC = observer(function Masthead() {
  /******************* STORE ***********************/

  const uiStore = useUIStore()

  /******************* STATE ***********************/

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  /******************* COMPUTED ***********************/

  const formattedDate = useMemo(() => {
    const now = new Date()
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }, [])

  /******************* FUNCTIONS ***********************/

  const handleSearchOpen = useCallback(() => {
    setIsSearchOpen(true)
    uiStore.toggleSearch()
  }, [uiStore])

  const handleSearchClose = useCallback(() => {
    setIsSearchOpen(false)
  }, [])

  const handleMobileMenuOpen = useCallback(() => {
    setIsMobileMenuOpen(true)
  }, [])

  const handleMobileMenuClose = useCallback(() => {
    setIsMobileMenuOpen(false)
  }, [])

  /******************* RENDER ***********************/

  return (
    <>
      <SearchOverlay isOpen={isSearchOpen} onClose={handleSearchClose} />
      <MobileMenu isOpen={isMobileMenuOpen} onClose={handleMobileMenuClose} />
      
      <header style={{ padding: '0 20px' }}>
        {/* Top bar - full width with date on left */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 0',
            borderBottom: '1px solid var(--color-rule)',
            width: '100%',
          }}
        >
          {/* Left - Date and Today's Paper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '11px',
                color: 'var(--color-ink)',
              }}
            >
              {formattedDate}
            </span>
            <Link
              href="/todays-paper"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '11px',
                color: 'var(--color-ink)',
                textDecoration: 'underline',
              }}
            >
              Today&apos;s Paper
            </Link>
          </div>

          {/* Right - Search and Account */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <button
              onClick={handleSearchOpen}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
              aria-label="Search"
              type="button"
            >
              <SearchIcon />
            </button>
            
            {/* Hamburger menu - mobile only */}
            <button
              onClick={handleMobileMenuOpen}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
              className="mobile-menu-button"
              aria-label="Open menu"
              type="button"
            >
              <HamburgerIcon />
            </button>
            
            <Link
              href="/admin"
              className="desktop-only"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              Log In
            </Link>
          </div>
        </div>

        {/* Masthead row - Title on left/center, Drug ticker on right */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 0',
          }}
        >
          {/* Spacer for centering on desktop */}
          <div className="masthead-spacer" style={{ flex: 1 }} />
          
          {/* Title - centered */}
          <Link href="/">
            <h1 className="masthead-title">
              The Wedding Times
            </h1>
          </Link>
          
          {/* Drug ticker - right side */}
          <div className="masthead-ticker" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <DrugTicker />
          </div>
        </div>
      </header>

      {/* CSS for responsive elements */}
      <style jsx global>{`
        .masthead-title {
          font-family: var(--font-masthead);
          font-weight: 400;
          letter-spacing: -0.01em;
          color: var(--color-ink);
          line-height: 1;
          margin: 0;
          white-space: nowrap;
          font-size: 2.2rem;
        }
        
        .masthead-spacer {
          display: none;
        }
        
        .masthead-ticker {
          display: none !important;
        }
        
        .mobile-menu-button {
          display: flex;
        }
        .desktop-only {
          display: none;
        }
        .desktop-nav {
          display: none;
        }
        
        @media (min-width: 768px) {
          .masthead-title {
            font-size: 8rem;
          }
          .masthead-spacer {
            display: block;
          }
          .masthead-ticker {
            display: flex !important;
          }
          .mobile-menu-button {
            display: none !important;
          }
          .desktop-only {
            display: flex !important;
          }
          .desktop-nav {
            display: flex !important;
          }
        }
      `}</style>
    </>
  )
})
