'use client'

import React, { useState, useCallback, useMemo } from 'react'

export const FALLBACK_IMAGE_SRC = '/logo-fallback.png'

/******************* TYPES ***********************/

interface FallbackImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt: string
  /** Fill the parent container (requires parent to have position: relative) */
  fill?: boolean
  /** Eagerly load the image (equivalent to loading="eager") */
  priority?: boolean
}

/******************* LOADING SPINNER ***********************/

const LoadingSpinner: React.FC = () => (
  <div className="absolute inset-0 flex items-center justify-center bg-[#f5f5f5]">
    <div className="relative w-8 h-8">
      <div className="absolute inset-0 border-2 border-[#e2e2e2] rounded-full" />
      <div className="absolute inset-0 border-2 border-transparent border-t-[#333] rounded-full animate-spin" />
    </div>
  </div>
)

/******************* COMPONENT ***********************/

/**
 * A native <img> wrapper that falls back to the logo when the original image
 * fails to load, and shows a loading spinner while the image is loading.
 *
 * Uses direct CDN URLs instead of Next.js Image optimization.
 */
export const FallbackImage: React.FC<FallbackImageProps> = ({
  src,
  alt,
  fill,
  priority,
  className,
  style,
  ...props
}) => {
  /******************* STORE ***********************/

  const [state, setState] = useState({
    originalSrc: src,
    displaySrc: src,
    hasError: false,
    isLoading: true,
  })

  /******************* COMPUTED ***********************/

  // If src prop changed, reset to show the new src and loading state
  const displaySrc = state.originalSrc === src ? state.displaySrc : src
  const hasError = state.originalSrc === src ? state.hasError : false
  const isLoading = state.originalSrc === src ? state.isLoading : true

  // Combine fill styles with any passed styles
  const combinedStyle = useMemo(() => {
    if (fill) {
      return {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        ...style,
      }
    }
    return style
  }, [fill, style])

  // Use a key that changes when we switch to fallback to force remount
  const imageKey = hasError ? 'fallback' : String(src)

  /******************* FUNCTIONS ***********************/

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

  /******************* RENDER ***********************/

  return (
    <>
      {isLoading && <LoadingSpinner />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={imageKey}
        src={displaySrc}
        alt={alt}
        className={className}
        style={combinedStyle}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        onLoad={handleLoad}
        onError={handleError}
        {...props}
      />
    </>
  )
}
