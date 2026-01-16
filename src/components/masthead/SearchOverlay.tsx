'use client'

import React, { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CloseIcon } from './icons'

interface SearchOverlayProps {
  isOpen: boolean
  onClose: () => void
}

export const SearchOverlay: React.FC<SearchOverlayProps> = React.memo(function SearchOverlay({
  isOpen,
  onClose,
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const router = useRouter()

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const formData = new FormData(e.currentTarget)
      const inputValue = (formData.get('search') as string) || searchQuery
      const trimmedQuery = inputValue.trim()
      if (trimmedQuery) {
        router.push(`/search?q=${encodeURIComponent(trimmedQuery)}`)
        onClose()
      }
    },
    [searchQuery, router, onClose],
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose],
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-white/[0.98] z-[9999] flex flex-col items-center pt-[120px]">
      <button
        onClick={onClose}
        className="absolute top-5 right-5 bg-transparent border-none cursor-pointer p-2"
        type="button"
        aria-label="Close search"
      >
        <CloseIcon />
      </button>
      <form onSubmit={handleSubmit} className="w-full max-w-[600px] px-5">
        <input
          type="text"
          name="search"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Search The Wedding Times..."
          autoFocus
          className="w-full text-2xl font-sans py-4 border-0 border-b-2 border-[#121212] outline-none bg-transparent"
        />
      </form>
    </div>
  )
})
