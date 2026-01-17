'use client'

import React, { useEffect, useRef, useState } from 'react'

/******************* CONSTANTS ***********************/

const CHECK_INTERVAL_MS = 60 * 60 * 1000
const BUILD_ID_ENDPOINT = '/api/build-id'

/******************* COMPONENT ***********************/

export function UpdateModalClient() {
  const [isVisible, setIsVisible] = useState(false)
  const currentBuildIdRef = useRef<string | null>(null)

  useEffect(() => {
    const initialBuildId = (window as Window & { __NEXT_DATA__?: { buildId?: string } })
      .__NEXT_DATA__?.buildId
    if (typeof initialBuildId === 'string') {
      currentBuildIdRef.current = initialBuildId
    }

    let intervalId: ReturnType<typeof setInterval> | null = null

    const checkForUpdate = async () => {
      if (!navigator.onLine) {
        return
      }

      try {
        const response = await fetch(BUILD_ID_ENDPOINT, { cache: 'no-store' })
        if (!response.ok) {
          return
        }

        const data = (await response.json()) as { buildId?: string }
        if (typeof data.buildId !== 'string' || data.buildId.length === 0) {
          return
        }

        if (!currentBuildIdRef.current) {
          currentBuildIdRef.current = data.buildId
          return
        }

        if (data.buildId !== currentBuildIdRef.current) {
          setIsVisible(true)
        }
      } catch {
        // Ignore network errors to avoid interrupting the UI.
      }
    }

    checkForUpdate()
    intervalId = setInterval(checkForUpdate, CHECK_INTERVAL_MS)

    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [])

  if (!isVisible) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        className="w-full max-w-md border border-[#121212] bg-white px-6 py-5 text-[#121212] shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
      >
        <h2 className="font-headline text-2xl font-bold">A fresh edition just landed</h2>
        <p className="mt-3 font-serif text-base text-[#333]">
          The press updated the site. Reload to get the latest headlines, typos, and bureaucratic
          delays.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-sans text-sm font-semibold px-4 py-2 border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white transition-colors"
          >
            Reload now
          </button>
          <span className="font-sans text-xs text-[#666]">
            We’ll keep this open until you refresh.
          </span>
        </div>
      </div>
    </div>
  )
}
