'use client'

import React, { useState, useCallback } from 'react'
import Image, { type ImageProps } from 'next/image'

export const FALLBACK_IMAGE_SRC = '/logo-fallback.png'

type FallbackImageProps = Omit<ImageProps, 'onError'>

/**
 * A wrapper around Next.js Image component that falls back to the logo
 * when the original image fails to load.
 *
 * Uses a state object that includes the original src to automatically
 * reset when the src prop changes.
 */
export const FallbackImage: React.FC<FallbackImageProps> = ({ src, alt, ...props }) => {
  // Track which src we're showing and whether it errored
  const [state, setState] = useState({ originalSrc: src, displaySrc: src, hasError: false })

  // If src prop changed, reset to show the new src
  const displaySrc = state.originalSrc === src ? state.displaySrc : src
  const hasError = state.originalSrc === src ? state.hasError : false

  const handleError = useCallback(() => {
    if (!hasError) {
      setState({ originalSrc: src, displaySrc: FALLBACK_IMAGE_SRC, hasError: true })
    }
  }, [src, hasError])

  // Use a key that changes when we switch to fallback to force remount
  const imageKey = hasError ? 'fallback' : String(src)

  return <Image key={imageKey} {...props} src={displaySrc} alt={alt} onError={handleError} />
}
