'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { observer } from 'mobx-react-lite'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUIStore } from '@/stores'
import { NytContainer } from './NytContainer'
import { DrugTicker } from './masthead/DrugTicker'
import { MobileMenu } from './masthead/MobileMenu'
import { SearchOverlay } from './masthead/SearchOverlay'
import { HamburgerIcon, SearchIcon } from './masthead/icons'

export const Masthead: React.FC = observer(function Masthead() {
  const uiStore = useUIStore()

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const pathname = usePathname()
  const isArticlePage = pathname.startsWith('/article/')

  const formattedDate = useMemo(() => {
    const now = new Date()
    return now.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }, [])

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

  return (
    <>
      <SearchOverlay isOpen={isSearchOpen} onClose={handleSearchClose} />
      <MobileMenu isOpen={isMobileMenuOpen} onClose={handleMobileMenuClose} />

      <header
        className={
          isArticlePage
            ? 'fixed top-0 left-0 right-0 bg-white z-50 border-b border-[#e2e2e2]'
            : undefined
        }
      >
        <NytContainer>
          {isArticlePage ? (
            <div className="relative flex items-center justify-between py-2">
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

              <Link
                href="/"
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              >
                <span className="font-masthead font-normal tracking-tight text-[#121212] leading-none whitespace-nowrap text-[2.25rem]">
                  The Wedding Times
                </span>
              </Link>

              <div className="w-10" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between py-2">
                <button
                  onClick={handleMobileMenuOpen}
                  className="bg-transparent border-none cursor-pointer p-1 flex items-center md:hidden"
                  aria-label="Open menu"
                  type="button"
                >
                  <HamburgerIcon />
                </button>

                <div className="flex items-center gap-4">
                  <button
                    onClick={handleSearchOpen}
                    className="bg-transparent border-none cursor-pointer p-1 flex items-center"
                    aria-label="Search"
                    type="button"
                  >
                    <SearchIcon />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-center md:justify-between py-3 pb-5">
                <div className="hidden md:flex flex-col flex-1">
                  <div className="font-sans text-[13px] text-[#121212]">{formattedDate}</div>
                  <Link
                    href="/archive"
                    className="font-sans text-[13px] text-[#121212] underline mt-1"
                  >
                    Archive
                  </Link>
                </div>

                <div className="text-center">
                  <Link href="/">
                    <h1 className="font-masthead font-normal tracking-tight text-[#121212] leading-none whitespace-nowrap text-[2.5rem] md:text-[5rem] lg:text-[6.5rem] xl:text-[7.5rem]">
                      The Wedding Times
                    </h1>
                  </Link>
                </div>

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
