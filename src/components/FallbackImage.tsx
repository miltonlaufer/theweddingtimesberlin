'use client'

import React, { useState, useCallback } from 'react'
import Image, { type ImageProps } from 'next/image'

const FALLBACK_IMAGE_SRC = '/logo-fallback.png'

type FallbackImageProps = Omit<ImageProps, 'onError'>

/**
 * A wrapper around Next.js Image component that falls back to the logo
 * when the original image fails to load.
 */
export const FallbackImage: React.FC<FallbackImageProps> = ({ src, alt, ...props }) => {
  const [imgSrc, setImgSrc] = useState(src)
  const [hasError, setHasError] = useState(false)

  const handleError = useCallback(() => {
    if (!hasError) {
      setHasError(true)
      setImgSrc(FALLBACK_IMAGE_SRC)
    }
  }, [hasError])

  return <Image {...props} src={imgSrc} alt={alt} onError={handleError} />
}
