import type { Metadata } from 'next'
import { AIComposeClient } from './AIComposeClient'

export const metadata: Metadata = {
  title: 'AI Compose',
}

export default function AIComposePage() {
  return <AIComposeClient />
}
