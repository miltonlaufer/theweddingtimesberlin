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
 * reset when the src prop changes (React will reset state when the key
 * differs from what was used to create the initial state).
 */
export const FallbackImage: React.FC<FallbackImageProps> = ({ src, alt, ...props }) => {
  // State holds both the current display src and the original src it was based on
  // When src prop changes, we detect it and show the new src (not fallback)
  const [state, setState] = useState({ originalSrc: src, displaySrc: src, hasError: false })

  // If src prop changed, reset to show the new src
  const displaySrc = state.originalSrc === src ? state.displaySrc : src
  const hasError = state.originalSrc === src ? state.hasError : false

  const handleError = useCallback(() => {
    if (!hasError) {
      setState({ originalSrc: src, displaySrc: FALLBACK_IMAGE_SRC, hasError: true })
    }
  }, [src, hasError])

  return <Image {...props} src={displaySrc} alt={alt} onError={handleError} />
}
