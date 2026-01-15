import React from 'react'
import Link from 'next/link'
import { Masthead, NavigationServer, SatiricalRibbon, FooterServer } from '@/components'
import { StoreProvider } from '@/stores'
import '../styles/global.css'

/******************* COMPONENT *******************/

export default function NotFound() {
  return (
    <div className="frontend-app">
      <StoreProvider>
        <div className="min-h-screen flex flex-col">
          <SatiricalRibbon />
          <Masthead />
          <NavigationServer />
          <main className="flex-1 flex items-center justify-center w-full">
            <div className="max-w-[680px] mx-auto px-5">
              <h1 className="font-headline text-3xl md:text-4xl font-bold text-[#121212]">
                Article not found
              </h1>
              <p className="mt-4 font-serif text-lg text-[#333] leading-relaxed">
                This page has been relocated to a better neighborhood. Probably gentrified.
              </p>
              <p className="mt-4 font-serif text-lg text-[#333] leading-relaxed">
                If this is Germany&apos;s internet, we apologize on its behalf. The page might still be waiting for its Anmeldung appointment.
              </p>

              <div className="mt-8 flex items-center gap-4">
                <Link
                  href="/"
                  className="font-sans text-sm font-semibold px-4 py-2 border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white transition-colors"
                >
                  Back to home
                </Link>
                <Link href="/archive" className="font-sans text-sm underline text-[#121212]">
                  Browse archive
                </Link>
              </div>
            </div>
          </main>
          <FooterServer />
        </div>
      </StoreProvider>
    </div>
  )
}
