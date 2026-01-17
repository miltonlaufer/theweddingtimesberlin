'use client'

import React, { useState, useCallback } from 'react'
import Image, { type ImageProps } from 'next/image'

export const FALLBACK_IMAGE_SRC = '/logo-fallback.png'

type FallbackImageProps = Omit<ImageProps, 'onError' | 'onLoad'>

/**
 * Loading spinner component
 */
const LoadingSpinner: React.FC = () => (
  <div className="absolute inset-0 flex items-center justify-center bg-[#f5f5f5]">
    <div className="relative w-8 h-8">
      <div className="absolute inset-0 border-2 border-[#e2e2e2] rounded-full" />
      <div className="absolute inset-0 border-2 border-transparent border-t-[#333] rounded-full animate-spin" />
    </div>
  </div>
)

/**
 * A wrapper around Next.js Image component that falls back to the logo
 * when the original image fails to load, and shows a loading spinner
 * while the image is loading.
 *
 * Uses a state object that includes the original src to automatically
 * reset when the src prop changes.
 */
export const FallbackImage: React.FC<FallbackImageProps> = ({ src, alt, ...props }) => {
  // Track which src we're showing, whether it errored, and loading state
  const [state, setState] = useState({
    originalSrc: src,
    displaySrc: src,
    hasError: false,
    isLoading: true,
  })

  // If src prop changed, reset to show the new src and loading state
  const displaySrc = state.originalSrc === src ? state.displaySrc : src
  const hasError = state.originalSrc === src ? state.hasError : false
  const isLoading = state.originalSrc === src ? state.isLoading : true

  const handleLoad = useCallback(() => {
    setState((prev) => ({
      ...prev,
      originalSrc: src,
      isLoading: false,
    }))
  }, [src])

  const handleError = useCallback(() => {
    if (!hasError) {
      setState({
        originalSrc: src,
        displaySrc: FALLBACK_IMAGE_SRC,
        hasError: true,
        isLoading: true, // Reset loading for fallback image
      })
    }
  }, [src, hasError])

  // Use a key that changes when we switch to fallback to force remount
  const imageKey = hasError ? 'fallback' : String(src)

  return (
    <>
      {isLoading && <LoadingSpinner />}
      <Image
        key={imageKey}
        {...props}
        src={displaySrc}
        alt={alt}
        onLoad={handleLoad}
        onError={handleError}
      />
    </>
  )
}
