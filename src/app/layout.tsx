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
  // Next.js 15 requires root layout to have <html> and <body> tags
  // Payload Admin's RootLayout will handle its own structure within the body
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
