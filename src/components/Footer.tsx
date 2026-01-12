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
      { name: 'Leopoldplatz', href: '/section/leopoldplatz' },
      { name: 'Nightlife', href: '/section/nightlife' },
      { name: 'Crime', href: '/section/crime' },
      { name: 'Kiez News', href: '/section/kiez' },
      { name: 'Gentrification', href: '/section/gentrification' },
    ],
  },
  {
    title: 'WEDDING LIFE',
    links: [
      { name: 'Doener & Drinks', href: '/section/food-drink' },
      { name: 'Techno', href: '/section/techno' },
      { name: 'Spaetkauf Reviews', href: '/section/spaeti' },
      { name: 'BVG Delays', href: '/section/bvg' },
      { name: 'Buergeramt Tips', href: '/section/buergeramt' },
      { name: 'Muellerstrasse', href: '/section/muellerstrasse' },
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
  /******************* COMPUTED ***********************/

  const currentYear = new Date().getFullYear()

  /******************* RENDER ***********************/

  return (
    <footer className="bg-[#f7f7f7] mt-12">
      {/* Top border */}
      <div className="border-t-2 border-[#121212]" />

      {/* Main footer content */}
      <div className="py-8 px-10">
        {/* Logo */}
        <div className="mb-6">
          <Link href="/" className="font-masthead text-[1.75rem] text-[#121212]">
            The Wedding Times
          </Link>
        </div>

        {/* Footer columns */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-8 pb-8 border-b border-[#e2e2e2]">
          {footerSections.map((section) => (
            <div key={section.title}>
              <h3 className="font-sans text-base font-bold tracking-wider text-[#121212] mb-3">
                {section.title}
              </h3>
              <ul className="list-none m-0 p-0">
                {section.links.map((link) => (
                  <li key={link.name} className="mb-2">
                    <Link href={link.href} className="font-sans text-[15px] text-[#121212]">
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom footer */}
        <div className="flex flex-wrap justify-between items-center pt-6 gap-4">
          <div className="flex flex-wrap items-center gap-2 font-sans text-[13px] text-[#666]">
            <span>&copy; {currentYear} The Wedding Times Berlin</span>
            <span className="mx-1">|</span>
            <Link href="/contact" className="text-inherit">Contact Us</Link>
            <span className="mx-1">|</span>
            <Link href="/accessibility" className="text-inherit">Accessibility</Link>
            <span className="mx-1">|</span>
            <Link href="/advertise" className="text-inherit">Advertise</Link>
            <span className="mx-1">|</span>
            <Link href="/privacy" className="text-inherit">Privacy Policy</Link>
            <span className="mx-1">|</span>
            <Link href="/terms" className="text-inherit">Terms of Service</Link>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="font-sans text-[13px] text-[#666] mt-4 leading-relaxed">
          THE WEDDING TIMES is a satirical publication about Berlin&apos;s Wedding neighbourhood.
          All articles, stories, and characters appearing in this publication are fictitious.
          Any resemblance to real persons, living or dead, is purely coincidental and unintentional.
          No actual Wedding residents were harmed in the making of this publication.
        </p>
      </div>
    </footer>
  )
})
