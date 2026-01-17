import React from 'react'
import { Masthead, NavigationServer, SatiricalRibbon, FooterServer } from '@/components'
import { UpdateModalClient } from '@/components/UpdateModalClient'
import { PushNotificationPrompt } from '@/components/PushNotificationPrompt'
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
    <div className="frontend-app">
      <GoogleAnalyticsClient />
      <StoreProvider>
        <div className="min-h-screen flex flex-col">
          <UpdateModalClient />
          <PushNotificationPrompt />
          <SatiricalRibbon />
          <Masthead />
          <NavigationServer />
          <main className="flex-1">{children}</main>
          <FooterServer />
        </div>
      </StoreProvider>
    </div>
  )
}
