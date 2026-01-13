import React from 'react'
import { Masthead, Navigation, SatiricalRibbon, Footer } from '@/components'
import { StoreProvider } from '@/stores'
import '../../styles/global.css'

/******************* TYPES ***********************/

interface FrontendLayoutProps {
  children: React.ReactNode
}

/******************* LAYOUT ***********************/

export default function FrontendLayout({ children }: FrontendLayoutProps) {
  return (
    <html lang="en">
      <body className="antialiased frontend-app">
        <StoreProvider>
          <div className="min-h-screen flex flex-col">
            <SatiricalRibbon />
            <Masthead />
            <Navigation />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </StoreProvider>
      </body>
    </html>
  )
}
