import React from 'react'
import { Masthead, NavigationServer, SatiricalRibbon, FooterServer } from '@/components'
import { StoreProvider } from '@/stores'
import '../../styles/global.css'
import { GoogleAnalyticsClient } from '@/components/GoogleAnalyticsClient'

/******************* TYPES ***********************/

interface FrontendLayoutProps {
  children: React.ReactNode
}

/******************* LAYOUT ***********************/

export default function FrontendLayout({ children }: FrontendLayoutProps) {
  return (
    <html lang="en">
      <body className="antialiased frontend-app">
        <GoogleAnalyticsClient />
        <StoreProvider>
          <div className="min-h-screen flex flex-col">
            <SatiricalRibbon />
            <Masthead />
            <NavigationServer />
            <main className="flex-1">{children}</main>
            <FooterServer />
          </div>
        </StoreProvider>
      </body>
    </html>
  )
}
