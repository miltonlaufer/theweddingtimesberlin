'use client'

import React, { useCallback, useMemo } from 'react'
import Link from 'next/link'

/******************* HELPERS ***********************/

function hashToIndex(input: string, modulo: number): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return modulo > 0 ? h % modulo : 0
}

/******************* TYPES ***********************/

interface ArticleErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/******************* COMPONENT ***********************/

export default function ArticleError({ error, reset }: ArticleErrorProps) {
  /******************* COMPUTED ***********************/

  const jokes = useMemo(
    () => [
      'Telekom says your article is loading. The article says it’s still buffering.',
      'Deutsche Bahn Wi‑Fi successfully connected to the concept of the internet.',
      'Your 5G signal is currently being routed through 2006 for authenticity.',
      'Berlin’s “fiber rollout” means someone drew a cable on a whiteboard.',
      'The article is available offline. So is most of Germany, apparently.',
      'This page is experiencing a classic “Anmeldung”: it exists, but nobody can find it.',
      'Your connection is so German it came with paperwork and a waiting list.',
      'The network is taking a Späti break. Try again after a small existential crisis.',
      'Telekom support suggests turning it off and on. Society, not the router.',
      'The signal went to Berghain. It might get rejected at the door.',
    ],
    [],
  )

  const joke = useMemo(() => {
    const key = `${error.digest ?? ''}|${error.message ?? ''}|${typeof window !== 'undefined' ? window.location.pathname : ''}`
    return jokes[hashToIndex(key, jokes.length)] ?? jokes[0]
  }, [error.digest, error.message, jokes])

  /******************* FUNCTIONS ***********************/

  const handleRetry = useCallback(() => {
    reset()
  }, [reset])

  /******************* RENDER ***********************/

  return (
    <main className="py-10 w-full">
      <div className="max-w-[680px] mx-auto px-5">
        <h1 className="font-headline text-3xl md:text-4xl font-bold text-[#121212]">
          Couldn’t load this article
        </h1>
        <p className="mt-4 font-serif text-lg text-[#333] leading-relaxed">{joke}</p>

        <div className="mt-8 flex items-center gap-4">
          <button
            type="button"
            onClick={handleRetry}
            className="font-sans text-sm font-semibold px-4 py-2 border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white transition-colors"
          >
            Try again
          </button>
          <Link href="/" className="font-sans text-sm underline text-[#121212]">
            Back to home
          </Link>
        </div>

        <p className="mt-8 font-sans text-xs text-[#666]">
          If this keeps happening, it’s likely a temporary connection/database issue. (We’ll also add full offline-mode support via PWA next.)
        </p>
      </div>
    </main>
  )
}

