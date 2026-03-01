import React from 'react'
import Link from 'next/link'

export function AIComposeNavLink() {
  return (
    <div style={{ padding: '0.5rem 0 0.75rem' }}>
      <Link
        href="/admin/ai-compose"
        style={{
          display: 'block',
          fontSize: '0.9rem',
          fontWeight: 600,
          textDecoration: 'none',
          color: 'var(--theme-text)',
        }}
      >
        AI Compose
      </Link>
    </div>
  )
}
