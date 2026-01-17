'use client'

import React from 'react'

/******************* COMPONENT ***********************/

export function OfflineReloadButton() {
  const handleReload = () => {
    window.location.reload()
  }

  return (
    <button
      type="button"
      onClick={handleReload}
      className="font-sans text-sm font-semibold px-4 py-2 border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white transition-colors"
    >
      Reload
    </button>
  )
}
