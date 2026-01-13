'use client'

import React, { useEffect, useMemo } from 'react'
import { observer } from 'mobx-react-lite'
import Link from 'next/link'
import Image from 'next/image'
import { useArticleStore } from '@/stores'
import { NytContainer } from '@/components/NytContainer'
import type { IArticle } from '@/types/article'

/******************* MOCK DATA ***********************/

const mockArticles: IArticle[] = [
  {
    id: '1',
    headline: 'Buergeramt Appointment Secured for 2027 After 3-Year Wait',
    subheadline: 'Local resident celebrates bureaucratic victory, plans to finally register address',
    slug: 'buergeramt-2027',
    featuredImageUrl: 'https://picsum.photos/seed/bureaucracy1/800/600',
    imageCaption: 'Photo by Wedding Bureaucracy Watch',
    content: '<p>Full article content here...</p>',
    excerpt:
      'In a landmark achievement for patience and perseverance, a Wedding resident has finally secured an appointment at the local Buergeramt for their Anmeldung, scheduled for the spring of 2027. The resident, who began their application process in 2024, expressed "cautious optimism" about the upcoming registration.',
    category: { id: 'c1', name: 'Bureaucracy', slug: 'bureaucracy', description: '', order: 0 },
    author: {
      id: 'a1',
      name: 'Greta Schmidt',
      slug: 'greta-schmidt',
      title: 'Bureaucracy Correspondent',
    },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: true,
    layout: 'standard',
  },
  {
    id: '2',
    headline: 'Schwabian Tourist Complains Wedding Too Dirty While Standing in Own Vomit',
    subheadline: 'Incident outside Spaeti sparks debate on urban hygiene standards',
    slug: 'schwabian-dirty-wedding',
    featuredImageUrl: 'https://picsum.photos/seed/dirtyberlin/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'A recent visitor from Stuttgart, identified only as "Klaus," was overheard loudly lamenting the perceived filth of Wedding streets, moments before slipping into a puddle of his own making outside a popular Spaeti on Muellerstrasse.',
    category: { id: 'c2', name: 'Nightlife', slug: 'nightlife', description: '', order: 1 },
    author: { id: 'a2', name: 'Hans Muller', slug: 'hans-muller', title: 'Kiez Reporter' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: true,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '3',
    headline: "Neukoelln Man Offers to 'Handle' Neighbour's Parking Dispute",
    slug: 'neukoelln-parking-dispute',
    featuredImageUrl: 'https://picsum.photos/seed/familydrama/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'Tensions flared on Seestrasse when a local man, a prominent figure from Neukoelln visiting his cousin in Wedding, reportedly offered to "have a chat" with a neighbour over a contested parking spot.',
    category: { id: 'c3', name: 'Kiez News', slug: 'kiez', description: '', order: 2 },
    author: { id: 'a3', name: 'Lena Richter', slug: 'lena-richter', title: 'Social Observer' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: true,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '4',
    headline: 'Prenzlauer Berg Mother Refuses to Let Child Play in Leopoldplatz',
    slug: 'prenzlauer-berg-leopoldplatz',
    content: '<p>Full article content here...</p>',
    excerpt:
      'A visiting mother from Prenzlauer Berg has refused to let her child use the playground at Leopoldplatz, citing concerns about "the wrong kind of diversity" and insufficient organic snack options.',
    category: { id: 'c4', name: 'Opinion', slug: 'opinion', description: '', order: 3 },
    author: { id: 'a4', name: 'Dr. Klaus Weber', slug: 'klaus-weber', title: 'Opinion Columnist' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'opinion',
  },
  {
    id: '5',
    headline: "Spaeti DJ's 6-Hour Techno Set Leaves Elderly Neighbours 'Forever Changed'",
    slug: 'spaeti-techno-set',
    featuredImageUrl: 'https://picsum.photos/seed/techno/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'What started as a quiet Thursday evening at a Reinickendorfer Strasse Spaeti quickly escalated into a six-hour odyssey of pulsating rhythms, leaving several elderly residents of the adjacent building questioning their life choices.',
    category: { id: 'c5', name: 'Techno', slug: 'techno', description: '', order: 4 },
    author: { id: 'a1', name: 'Greta Schmidt', slug: 'greta-schmidt' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '6',
    headline: 'Man Found at Leopoldplatz Claims He "Just Got Here"',
    slug: 'man-leopoldplatz',
    featuredImageUrl: 'https://picsum.photos/seed/party/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'Emergency services were called to Leopoldplatz where a man was found unresponsive on a bench. Upon regaining consciousness, he insisted he had "just arrived" despite witnesses confirming he had been there since Tuesday.',
    category: { id: 'c2', name: 'Nightlife', slug: 'nightlife', description: '', order: 1 },
    author: { id: 'a3', name: 'Lena Richter', slug: 'lena-richter' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '7',
    headline: 'New Doener Shop on Muellerstrasse Declared "Elevated German Cuisine"',
    slug: 'doener-elevated',
    content: '<p>Full article content here...</p>',
    excerpt:
      'A newly opened Doener shop on Muellerstrasse has sparked controversy by charging 12 euros for a "deconstructed Doener experience" and referring to their garlic sauce as "artisanal aioli".',
    category: { id: 'c6', name: 'Doener & Drinks', slug: 'food-drink', description: '', order: 5 },
    author: { id: 'a2', name: 'Hans Muller', slug: 'hans-muller' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '8',
    headline: 'Local Resident Still Waiting for Anmeldung to Legally Exist',
    slug: 'anmeldung-waiting',
    featuredImageUrl: 'https://picsum.photos/seed/bureaucracy2/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'A Wedding resident entering their third year without an Anmeldung appointment has begun to question whether they legally exist, as they remain unable to open a bank account, sign a phone contract, or prove their identity.',
    category: { id: 'c1', name: 'Bureaucracy', slug: 'bureaucracy', description: '', order: 0 },
    author: { id: 'a4', name: 'Dr. Klaus Weber', slug: 'klaus-weber' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'standard',
  },
]

/******************* HOMEPAGE COMPONENT ***********************/

export default observer(function HomePage() {
  /******************* STORE ***********************/

  const articleStore = useArticleStore()

  /******************* COMPUTED ***********************/

  const headlineArticle = useMemo(() => mockArticles.find((a) => a.isHeadline), [])
  const leftColumnArticles = useMemo(() => mockArticles.filter((a) => !a.isHeadline && a.layout !== 'opinion').slice(0, 3), [])
  const rightColumnArticles = useMemo(() => mockArticles.filter((a) => !a.isHeadline && a.layout !== 'opinion').slice(3, 7), [])
  const opinionArticle = useMemo(() => mockArticles.find((a) => a.layout === 'opinion'), [])

  /******************* EFFECTS ***********************/

  useEffect(() => {
    // articleStore.fetchAll()
  }, [articleStore])

  /******************* RENDER ***********************/

  return (
    <main className="py-6 w-full">
      <NytContainer>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr_320px] lg:gap-0">
          {/* Left Column: Text-only articles */}
          <div className="lg:pr-7 lg:border-r lg:border-[#e2e2e2]">
            {leftColumnArticles.map((article, index) => (
              <Link
                key={article.id}
                href={`/article/${article.slug}`}
                className={`group block ${index < leftColumnArticles.length - 1 ? 'border-b border-[#e2e2e2]' : ''}`}
                aria-label={article.headline}
              >
                <article className="pb-6 mb-6">
                  <h3 className="font-headline text-[24px] font-semibold leading-[1.14] tracking-[-0.01em] text-[#121212] mb-3 transition-colors duration-150 group-hover:text-[#555]">
                    {article.headline}
                  </h3>
                  <p className="font-serif text-[19px] leading-[1.3] text-[#333]">
                    {article.excerpt}
                  </p>
                  <p className="font-sans text-[13px] font-medium text-[#666] mt-1.5 uppercase tracking-wider">
                    6 MIN READ
                  </p>
                </article>
              </Link>
            ))}
          </div>

          {/* Center Column: Main headline with large image */}
          <div className="lg:px-7 lg:border-r lg:border-[#e2e2e2]">
            {headlineArticle && (
              <Link
                href={`/article/${headlineArticle.slug}`}
                className="group block"
                aria-label={headlineArticle.headline}
              >
                <article>
                  {headlineArticle.featuredImageUrl && (
                    <div className="relative w-full aspect-[16/10] mb-3">
                      <Image
                        src={headlineArticle.featuredImageUrl}
                        alt={headlineArticle.headline}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 50vw"
                        priority
                      />
                    </div>
                  )}
                  {headlineArticle.imageCaption && (
                    <p className="font-sans text-sm text-[#666] mb-4 text-right">
                      {headlineArticle.imageCaption}
                    </p>
                  )}
                  <h2 className="font-headline text-[38px] font-semibold leading-[1.06] tracking-[-0.015em] text-[#121212] mb-3 transition-colors duration-150 group-hover:text-[#555]">
                    {headlineArticle.headline}
                  </h2>
                  {headlineArticle.subheadline && (
                    <p className="font-serif text-[20px] leading-[1.24] text-[#333] mb-3">
                      {headlineArticle.subheadline}
                    </p>
                  )}
                  <p className="font-serif text-[19px] leading-[1.3] text-[#333]">
                    {headlineArticle.excerpt}
                  </p>
                </article>
              </Link>
            )}
          </div>

          {/* Right Column: Articles with thumbnails */}
          <div className="lg:pl-7">
            {rightColumnArticles.map((article, index) => (
              <Link
                key={article.id}
                href={`/article/${article.slug}`}
                className={`group block ${index < rightColumnArticles.length - 1 ? 'border-b border-[#e2e2e2]' : ''}`}
                aria-label={article.headline}
              >
                <article className="pb-5 mb-5">
                  {article.featuredImageUrl && (
                    <div className="relative w-full aspect-[16/10] mb-3">
                      <Image
                        src={article.featuredImageUrl}
                        alt={article.headline}
                        fill
                        className="object-cover"
                        sizes="(max-width: 1024px) 100vw, 320px"
                      />
                    </div>
                  )}

                  <h3 className="font-headline text-[18px] font-semibold leading-[1.15] tracking-[-0.01em] text-[#121212] mb-2 transition-colors duration-150 group-hover:text-[#555]">
                    {article.headline}
                  </h3>
                  <p className="font-serif text-[17px] leading-[1.3] text-[#333] line-clamp-3">
                    {article.excerpt}
                  </p>
                  <p className="font-sans text-xs font-medium text-[#666] mt-1.5 uppercase tracking-wider">
                    5 MIN READ
                  </p>
                </article>
              </Link>
            ))}

            {/* Opinion Section */}
            {opinionArticle && (
              <div className="mt-7 pt-6 border-t-2 border-[rgba(18,18,18,0.45)]">
                <h4 className="font-sans text-lg font-bold uppercase tracking-wider text-[#121212] mb-4">
                  Opinion
                </h4>
                <article>
                  {opinionArticle.author?.name && (
                    <p className="font-sans text-base font-bold text-[#121212] mb-2">
                      {opinionArticle.author.name}
                    </p>
                  )}
                  <Link
                    href={`/article/${opinionArticle.slug}`}
                    className="group block"
                    aria-label={opinionArticle.headline}
                  >
                    <h3 className="font-headline text-[20px] font-medium leading-[1.25] text-[#121212] transition-colors duration-150 group-hover:text-[#555]">
                      {opinionArticle.headline}
                    </h3>
                  </Link>
                </article>
              </div>
            )}
          </div>
        </div>
      </NytContainer>
    </main>
  )
})
