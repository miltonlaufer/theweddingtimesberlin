'use client'

import React from 'react'

/******************* TYPES ***********************/

interface NytContainerProps {
  children: React.ReactNode
  className?: string
}

/******************* MAIN COMPONENT ***********************/

export const NytContainer: React.FC<NytContainerProps> = React.memo(function NytContainer({
  children,
  className,
}) {
  /******************* STORE ***********************/

  /******************* COMPUTED ***********************/

  const combinedClassName = `mx-auto w-full max-w-[1200px] px-5 ${className ?? ''}`.trim()

  /******************* FUNCTIONS ***********************/

  /******************* EFFECTS ***********************/

  return <div className={combinedClassName}>{children}</div>
})

