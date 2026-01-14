'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import ReactGA from 'react-ga4'

/******************* COMPONENT ***********************/

export function GoogleAnalyticsClient() {
  /******************* STORE ***********************/

  // none

  /******************* COMPUTED ***********************/

  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? ''

  const pathname = usePathname()

  /******************* FUNCTIONS ***********************/

  const sendPageView = useCallback((path: string) => {
    ReactGA.send({ hitType: 'pageview', page: path })
  }, [])

  /******************* useEffects ***********************/

  const didInitRef = useRef(false)

  useEffect(() => {
    if (!measurementId) return
    if (didInitRef.current) return

    ReactGA.initialize(measurementId)
    didInitRef.current = true
  }, [measurementId])

  useEffect(() => {
    if (!measurementId) return
    if (!didInitRef.current) return

    const page =
      typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : pathname

    sendPageView(page)
  }, [measurementId, pathname, sendPageView])

  return null
}

