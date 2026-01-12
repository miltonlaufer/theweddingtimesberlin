'use client'

import React from 'react'
import Link from 'next/link'

/******************* FOOTER SECTIONS ***********************/

const footerSections = [
  {
    title: 'NEWS',
    links: [
      { name: 'Home Page', href: '/' },
      { name: 'Bureaucracy', href: '/section/bureaucracy' },
      { name: 'Reception', href: '/section/reception' },
      { name: 'Nightlife', href: '/section/nightlife' },
      { name: 'Family Drama', href: '/section/family' },
      { name: 'Kiez News', href: '/section/kiez' },
      { name: 'Gentrification', href: '/section/gentrification' },
    ],
  },
  {
    title: 'BERLIN LIFE',
    links: [
      { name: 'Doener & Drinks', href: '/section/food-drink' },
      { name: 'Techno', href: '/section/techno' },
      { name: 'Spaetkauf Reviews', href: '/section/spaeti' },
      { name: 'BVG Delays', href: '/section/bvg' },
      { name: 'Buergeramt Tips', href: '/section/buergeramt' },
      { name: 'Gorlitzer Park', href: '/section/goerlitzer' },
    ],
  },
  {
    title: 'OPINION',
    links: [
      { name: "Today's Opinion", href: '/section/opinion' },
      { name: 'Expat Complaints', href: '/expat-complaints' },
      { name: 'Schwaben vs Berlin', href: '/schwaben' },
      { name: 'Guest Essays', href: '/guest-essays' },
      { name: 'Letters', href: '/letters' },
    ],
  },
  {
    title: 'MORE',
    links: [
      { name: 'About', href: '/about' },
      { name: 'Contact Us', href: '/contact' },
      { name: 'Advertise', href: '/advertise' },
      { name: 'Submit a Story', href: '/submit' },
      { name: 'Corrections', href: '/corrections' },
      { name: 'Archive', href: '/archive' },
    ],
  },
]

/******************* COMPONENT ***********************/

export const Footer: React.FC = React.memo(function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer style={{ backgroundColor: '#f7f7f7', marginTop: '48px' }}>
      {/* Top border */}
      <div style={{ borderTop: '2px solid var(--color-ink)' }} />

      {/* Main footer content */}
      <div style={{ padding: '32px 40px' }}>
        {/* Logo */}
        <div style={{ marginBottom: '24px' }}>
          <Link href="/" style={{ fontFamily: 'var(--font-masthead)', fontSize: '1.75rem', color: 'var(--color-ink)' }}>
            The Wedding Times
          </Link>
        </div>

        {/* Footer columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '32px',
            paddingBottom: '32px',
            borderBottom: '1px solid var(--color-rule)',
          }}
        >
          {footerSections.map((section) => (
            <div key={section.title}>
              <h3
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  color: 'var(--color-ink)',
                  marginBottom: '12px',
                }}
              >
                {section.title}
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {section.links.map((link) => (
                  <li key={link.name} style={{ marginBottom: '8px' }}>
                    <Link
                      href={link.href}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: '13px',
                        color: 'var(--color-ink)',
                      }}
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom footer */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '24px',
            gap: '16px',
          }}
        >
          {/* Copyright and links */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--font-sans)',
              fontSize: '11px',
              color: 'var(--color-ink-lighter)',
            }}
          >
            <span>&copy; {currentYear} The Wedding Times Berlin</span>
            <span style={{ margin: '0 4px' }}>|</span>
            <Link href="/contact" style={{ color: 'inherit' }}>Contact Us</Link>
            <span style={{ margin: '0 4px' }}>|</span>
            <Link href="/accessibility" style={{ color: 'inherit' }}>Accessibility</Link>
            <span style={{ margin: '0 4px' }}>|</span>
            <Link href="/advertise" style={{ color: 'inherit' }}>Advertise</Link>
            <span style={{ margin: '0 4px' }}>|</span>
            <Link href="/privacy" style={{ color: 'inherit' }}>Privacy Policy</Link>
            <span style={{ margin: '0 4px' }}>|</span>
            <Link href="/terms" style={{ color: 'inherit' }}>Terms of Service</Link>
          </div>
        </div>

        {/* Disclaimer */}
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            color: 'var(--color-ink-lighter)',
            marginTop: '16px',
            lineHeight: 1.5,
          }}
        >
          THE WEDDING TIMES is a satirical publication. All articles, stories, and characters appearing in this publication are fictitious.
          Any resemblance to real persons, living or dead, is purely coincidental and unintentional.
          No actual wedding guests were harmed in the making of this publication.
        </p>
      </div>
    </footer>
  )
})
