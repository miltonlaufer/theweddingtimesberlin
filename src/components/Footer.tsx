'use client'

import React from 'react'
import Link from 'next/link'
import { NytContainer } from './NytContainer'
import { PushNotificationButton } from './PushNotificationButton'

/******************* TYPES ***********************/

interface FooterProps {
  categories: Array<{ name: string; slug: string }>
}

/******************* FOOTER SECTIONS ***********************/

const newsLinks = [{ name: 'Home Page', href: '/' }]

const moreLinks = [
  { name: 'About', href: '/about' },
  { name: 'Contact Us', href: '/contact' },
  { name: 'Submit a Story', href: '/submit' },
  { name: 'Archive', href: '/archive' },
  { name: 'RSS Feed', href: '/feed.xml' },
]

/******************* COMPONENT ***********************/

export const Footer: React.FC<FooterProps> = React.memo(function Footer({ categories }) {
  /******************* COMPUTED ***********************/

  const currentYear = new Date().getFullYear()

  // Split categories into two columns (left to right, then down)
  const midPoint = Math.ceil(categories.length / 2)
  const leftColumnCategories = categories.slice(0, midPoint)
  const rightColumnCategories = categories.slice(midPoint)

  /******************* RENDER ***********************/

  return (
    <footer className="bg-[#f7f7f7] mt-12">
      {/* Top border */}
      <div className="border-t-2 border-[#121212]" />

      {/* Main footer content */}
      <NytContainer className="py-8">
        {/* Logo */}
        <div className="mb-6">
          <Link href="/" className="font-masthead text-[1.75rem] text-[#121212]">
            The Wedding Times
          </Link>
        </div>

        {/* Footer columns */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-[#e2e2e2]">
          {/* NEWS Column */}
          <div>
            <h3 className="font-sans text-base font-bold tracking-wider text-[#121212] mb-3">
              NEWS
            </h3>
            <ul className="list-none m-0 p-0">
              {newsLinks.map((link) => (
                <li key={link.name} className="mb-2">
                  <Link href={link.href} className="font-sans text-[15px] text-[#121212]">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Navigation Categories - First Column */}
          <div>
            {leftColumnCategories.map((category) => (
              <div key={category.slug} className="mb-2">
                <Link
                  href={`/section/${category.slug}`}
                  className="font-sans text-[15px] text-[#121212]"
                >
                  {category.name}
                </Link>
              </div>
            ))}
          </div>

          {/* Navigation Categories - Second Column */}
          <div>
            {rightColumnCategories.map((category) => (
              <div key={category.slug} className="mb-2">
                <Link
                  href={`/section/${category.slug}`}
                  className="font-sans text-[15px] text-[#121212]"
                >
                  {category.name}
                </Link>
              </div>
            ))}
          </div>

          {/* MORE Column */}
          <div>
            <h3 className="font-sans text-base font-bold tracking-wider text-[#121212] mb-3">
              MORE
            </h3>
            <ul className="list-none m-0 p-0">
              {moreLinks.map((link) => (
                <li key={link.name} className="mb-2">
                  <Link href={link.href} className="font-sans text-[15px] text-[#121212]">
                    {link.name}
                  </Link>
                </li>
              ))}
              <li className="mb-2">
                <a
                  href="https://www.instagram.com/theweddingtimesberlin/"
                  className="font-sans text-[15px] text-[#121212] inline-flex items-center"
                  target="_blank"
                  rel="noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/instagram.svg"
                    alt="Instagram"
                    width={12}
                    height={12}
                    className="mr-2"
                  />
                  Instagram
                </a>
              </li>
              <li className="mb-2">
                <a
                  href="https://github.com/miltonlaufer/theweddingtimesberlin"
                  className="font-sans text-[15px] text-[#121212] inline-flex items-center"
                  target="_blank"
                  rel="noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/github.svg" alt="GitHub" width={12} height={12} className="mr-2" />
                  Source Code
                </a>
              </li>
            </ul>
            {/* Push Notifications */}
            <ul className="list-none m-0 p-0">
              <PushNotificationButton />
            </ul>
          </div>
        </div>

        {/* Bottom footer */}
        <div className="flex flex-wrap justify-between items-center pt-6 gap-4">
          <div className="flex flex-wrap items-center gap-2 font-sans text-[13px] text-[#666]">
            <span>&copy; {currentYear} The Wedding Times Berlin</span>
            <span className="mx-1">|</span>
            <Link href="/contact" className="text-inherit">
              Contact Us
            </Link>
            <span className="mx-1">|</span>
            <Link href="/accessibility" className="text-inherit">
              Accessibility
            </Link>
            <span className="mx-1">|</span>
            <Link href="/privacy" className="text-inherit">
              Privacy Policy
            </Link>
            <span className="mx-1">|</span>
            <Link href="/terms" className="text-inherit">
              Terms of Service
            </Link>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="font-sans text-[13px] text-[#666] mt-4 leading-relaxed">
          THE WEDDING TIMES is a satirical publication about Berlin&apos;s Wedding neighbourhood.
          All articles, stories, and characters appearing in this publication are fictitious. Any
          resemblance to real persons, living or dead, is purely coincidental and unintentional. No
          actual Wedding residents were harmed in the making of this publication.
        </p>
      </NytContainer>
    </footer>
  )
})
