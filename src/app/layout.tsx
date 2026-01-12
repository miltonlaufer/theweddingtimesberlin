import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'The Wedding Times | Berlin',
  description:
    'All the News That\'s Fit to Wed - Berlin\'s Premier Satirical Wedding Publication',
  keywords: ['wedding', 'satire', 'humor', 'berlin', 'newspaper'],
  openGraph: {
    title: 'The Wedding Times | Berlin',
    description: 'All the News That\'s Fit to Wed',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/* Blackletter font for masthead - English Towne from CDN */}
        <link
          rel="stylesheet"
          href="https://fonts.cdnfonts.com/css/english-towne"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}
