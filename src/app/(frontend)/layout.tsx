import React from 'react'
import { Masthead, Navigation, SatiricalRibbon, Footer } from '@/components'
import { StoreProvider } from '@/stores'

/******************* TYPES ***********************/

interface FrontendLayoutProps {
  children: React.ReactNode
}

/******************* LAYOUT ***********************/

export default function FrontendLayout({ children }: FrontendLayoutProps) {
  return (
    <StoreProvider>
      <div className="min-h-screen flex flex-col">
        <SatiricalRibbon />
        <Masthead />
        <Navigation />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </StoreProvider>
  )
}
