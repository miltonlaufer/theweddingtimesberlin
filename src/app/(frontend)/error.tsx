'use client'

import React, { useCallback } from 'react'
import Link from 'next/link'

/******************* TYPES ***********************/

interface FrontendErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/******************* COMPONENT ***********************/

export default function FrontendError({ reset }: FrontendErrorProps) {
  /******************* FUNCTIONS ***********************/

  const handleRetry = useCallback(() => {
    reset()
  }, [reset])

  /******************* RENDER ***********************/

  return (
    <main className="flex items-center justify-center min-h-screen w-full">
      <div className="max-w-[680px] mx-auto px-5">
        <h1 className="font-headline text-3xl md:text-4xl font-bold text-[#121212]">
          Something went wrong
        </h1>
        <p className="mt-4 font-serif text-lg text-[#333] leading-relaxed">
          If this is Germany&apos;s internet, we apologize on its behalf.
        </p>

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
      </div>
    </main>
  )
}

