'use client'

import React from 'react'

export const SatiricalRibbon: React.FC = React.memo(function SatiricalRibbon() {
  return (
    <div className="fixed top-3 -right-9 z-100 pointer-events-none">
      <div className="bg-[#d32f2f] text-white font-sans text-[9px] font-bold uppercase tracking-wider py-1 px-9 rotate-45 shadow-md">
        Satirical
      </div>
    </div>
  )
})
