'use client'

import React, { useEffect, useState } from 'react'

const drugNames = ['Weed', 'MDMA', 'Ket', 'Coke', 'Speed', 'Shrooms', 'LSD', '2C-B']

function generateRandomPrice(): { price: string; isUp: boolean } {
  const isUp = Math.random() > 0.4
  const change = (Math.random() * 15 + 0.5).toFixed(2)
  return {
    price: `${isUp ? '+' : '-'}${change}%`,
    isUp,
  }
}

export const DrugTicker: React.FC = React.memo(function DrugTicker() {
  const [currentIndex, setCurrentIndex] = useState(0)
  // Initialize with a consistent default to avoid hydration mismatch
  // The price will be updated after mount via the interval
  const [currentPrice, setCurrentPrice] = useState<{ price: string; isUp: boolean }>({
    price: '+0.00%',
    isUp: true,
  })
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    // Start the ticker animation after mount to avoid hydration mismatch
    // Use setTimeout to defer the initial update, avoiding setState in effect
    const initialTimeout = setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % drugNames.length)
      setCurrentPrice(generateRandomPrice())
    }, 0)

    const interval = setInterval(() => {
      setIsVisible(false)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % drugNames.length)
        setCurrentPrice(generateRandomPrice())
        setIsVisible(true)
      }, 500)
    }, 4000)

    return () => {
      clearTimeout(initialTimeout)
      clearInterval(interval)
    }
  }, [])

  return (
    <div
      className={`flex items-center font-sans text-lg transition-opacity duration-500 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span className="text-[#666] mr-2">{drugNames[currentIndex]}</span>
      <span
        className={`font-semibold text-xl ${currentPrice.isUp ? 'text-[#0a7c00]' : 'text-[#d32f2f]'}`}
      >
        {currentPrice.price}
      </span>
      <span className={`ml-1 text-xs ${currentPrice.isUp ? 'text-[#0a7c00]' : 'text-[#d32f2f]'}`}>
        {currentPrice.isUp ? '▲' : '▼'}
      </span>
    </div>
  )
})
