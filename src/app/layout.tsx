import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'The Wedding Times | Berlin',
  description:
    'All the News That\'s Fit to Print - Berlin Wedding\'s Premier Satirical Neighbourhood Publication',
  keywords: ['Wedding', 'Berlin', 'satire', 'humor', 'newspaper', 'neighbourhood', 'kiez'],
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
  return children
}
