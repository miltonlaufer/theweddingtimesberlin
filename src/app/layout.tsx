import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'The Wedding Times | Berlin',
  description:
    'All the News That\'s Fit to Print - Berlin Wedding\'s Premier Satirical Neighbourhood Publication',
  keywords: ['Wedding', 'Berlin', 'satire', 'humor', 'newspaper', 'neighbourhood', 'kiez'],
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'The Wedding Times | Berlin',
    description: 'All the News That\'s Fit to Print - Berlin Wedding',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Payload Admin's RootLayout renders its own <html>/<body>.
  // To avoid invalid nested html/body tags, we delegate html/body to route-group layouts.
  return children
}
