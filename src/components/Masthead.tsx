'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { observer } from 'mobx-react-lite'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUIStore } from '@/stores'
import { NytContainer } from './NytContainer'

/******************* DRUG PRICES DATA ***********************/

const drugNames = ['Weed', 'MDMA', 'Ket', 'Coke', 'Speed', 'Shrooms', 'LSD', '2C-B']

function generateRandomPrice(): { price: string; isUp: boolean } {
  const isUp = Math.random() > 0.4 // 60% chance up
  const change = (Math.random() * 15 + 0.5).toFixed(2) // 0.50% to 15.50%
  return {
    price: `${isUp ? '+' : '-'}${change}%`,
    isUp,
  }
}

/******************* ICONS ***********************/

const SearchIcon: React.FC = React.memo(function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
})

const HamburgerIcon: React.FC = React.memo(function HamburgerIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
})

const CloseIcon: React.FC = React.memo(function CloseIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
})

/******************* DRUG TICKER ***********************/

const DrugTicker: React.FC = React.memo(function DrugTicker() {
  /******************* STATE ***********************/

  const [currentIndex, setCurrentIndex] = useState(0)
  const [currentPrice, setCurrentPrice] = useState(generateRandomPrice)
  const [isVisible, setIsVisible] = useState(true)

  /******************* EFFECTS ***********************/

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % drugNames.length)
        setCurrentPrice(generateRandomPrice()) // New random price each time
        setIsVisible(true)
      }, 500)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  /******************* RENDER ***********************/

  return (
    <div
      className={`flex items-center font-sans text-lg transition-opacity duration-500 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span className="text-[#666] mr-2">{drugNames[currentIndex]}</span>
      <span className={`font-semibold text-xl ${currentPrice.isUp ? 'text-[#0a7c00]' : 'text-[#d32f2f]'}`}>
        {currentPrice.price}
      </span>
      <span className={`ml-1 text-xs ${currentPrice.isUp ? 'text-[#0a7c00]' : 'text-[#d32f2f]'}`}>
        {currentPrice.isUp ? '▲' : '▼'}
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
  /******************* STATE ***********************/

  const [searchQuery, setSearchQuery] = useState('')

  /******************* FUNCTIONS ***********************/

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      alert(`Search functionality coming soon! You searched for: "${searchQuery}"`)
    }
  }, [searchQuery])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  /******************* RENDER ***********************/

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-white/[0.98] z-[9999] flex flex-col items-center pt-[120px]">
      <button
        onClick={onClose}
        className="absolute top-5 right-5 bg-transparent border-none cursor-pointer p-2"
        type="button"
        aria-label="Close search"
      >
        <CloseIcon />
      </button>
      <form onSubmit={handleSubmit} className="w-full max-w-[600px] px-5">
        <input
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          placeholder="Search The Wedding Times..."
          autoFocus
          className="w-full text-2xl font-sans py-4 border-0 border-b-2 border-[#121212] outline-none bg-transparent"
        />
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
  { name: 'Leopoldplatz', slug: 'leopoldplatz' },
  { name: 'Nightlife', slug: 'nightlife' },
  { name: 'Opinion', slug: 'opinion' },
  { name: 'Doener & Drinks', slug: 'food-drink' },
  { name: 'Crime', slug: 'crime' },
  { name: 'Techno', slug: 'techno' },
  { name: 'Kiez News', slug: 'kiez' },
]

const MobileMenu: React.FC<MobileMenuProps> = React.memo(function MobileMenu({ isOpen, onClose }) {
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

  const pathname = usePathname()
  const isArticlePage = pathname.startsWith('/article/')

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
      
      <header className={isArticlePage ? 'border-b border-[#e2e2e2]' : undefined}>
        <NytContainer>
          {isArticlePage ? (
            <>
              {/* Article header: compact masthead + burger/search, no ticker, no category nav */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleMobileMenuOpen}
                    className="bg-transparent border-none cursor-pointer p-1 flex items-center"
                    aria-label="Open menu"
                    type="button"
                  >
                    <HamburgerIcon />
                  </button>
                  <button
                    onClick={handleSearchOpen}
                    className="bg-transparent border-none cursor-pointer p-1 flex items-center"
                    aria-label="Search"
                    type="button"
                  >
                    <SearchIcon />
                  </button>
                </div>

                <Link href="/" className="text-center">
                  <span className="font-masthead font-normal tracking-tight text-[#121212] leading-none whitespace-nowrap text-[2.25rem]">
                    The Wedding Times
                  </span>
                </Link>

                <div className="w-10" />
              </div>
            </>
          ) : (
            <>
              {/* Homepage header: Search left, Account right */}
              <div className="flex items-center justify-between py-2">
                <button
                  onClick={handleSearchOpen}
                  className="bg-transparent border-none cursor-pointer p-1 flex items-center"
                  aria-label="Search"
                  type="button"
                >
                  <SearchIcon />
                </button>

                <div className="flex items-center gap-4">
                  <button
                    onClick={handleMobileMenuOpen}
                    className="bg-transparent border-none cursor-pointer p-1 flex items-center md:hidden"
                    aria-label="Open menu"
                    type="button"
                  >
                    <HamburgerIcon />
                  </button>
                </div>
              </div>

              {/* Row 2: Date left, Masthead center, Ticker right */}
              <div className="flex items-center justify-between py-3 pb-5">
                {/* Left - Date and Archive */}
                <div className="hidden md:flex flex-col flex-1">
                  <div className="font-sans text-[13px] text-[#121212]">{formattedDate}</div>
                  <Link href="/archive" className="font-sans text-[13px] text-[#121212]">
                    Archive
                  </Link>
                </div>

                {/* Center - Masthead */}
                <div className="text-center">
                  <Link href="/">
                    <h1 className="font-masthead font-normal tracking-tight text-[#121212] leading-none whitespace-nowrap text-[2.5rem] md:text-[5rem] lg:text-[6.5rem] xl:text-[7.5rem]">
                      The Wedding Times
                    </h1>
                  </Link>
                </div>

                {/* Right - Drug ticker */}
                <div className="hidden md:flex flex-1 justify-end items-center">
                  <DrugTicker />
                </div>
              </div>
            </>
          )}
        </NytContainer>
      </header>
    </>
  )
})
