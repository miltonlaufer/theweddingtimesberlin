import React from 'react'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { getBaseUrl } from '@/lib/getBaseUrl'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'Submit a Story | The Wedding Times',
    description: 'Submit your story ideas, tips, and submissions to The Wedding Times. We welcome contributions from Wedding residents and Berliners.',
    openGraph: {
      title: 'Submit a Story | The Wedding Times',
      description: 'Submit your story ideas, tips, and submissions to The Wedding Times. We welcome contributions from Wedding residents and Berliners.',
      type: 'website',
      url: `${baseUrl}/submit`,
      images: [
        {
          url: logoUrl,
          width: 200,
          height: 200,
          alt: 'The Wedding Times',
        },
      ],
    },
  }
}

/******************* PAGE ***********************/

export default function SubmitPage() {
  return (
    <NytContainer className="py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="font-headline text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-6">
          Submit a Story
        </h1>

        <div className="font-serif text-[17px] leading-[1.6] text-[#333] space-y-6">
          <p>
            The Wedding Times welcomes story submissions, tips, and ideas from Wedding residents and Berliners. We&apos;re always looking for interesting stories about neighbourhood life, local events, cultural happenings, and the unique experiences that make Wedding special.
          </p>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              What We&apos;re Looking For
            </h2>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Local news and events in Wedding</li>
              <li>Opinion pieces and commentary</li>
              <li>Food and drink recommendations</li>
              <li>Neighbourhood observations and stories</li>
              <li>Cultural events and happenings</li>
              <li>Satirical takes on local issues</li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              How to Submit
            </h2>
            <p>
              Please send your story ideas, tips, or submissions to us through our{' '}
              <a href="/contact" className="text-[#121212] underline hover:text-[#555]">
                Contact Us
              </a>{' '}
              page. Include:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
              <li>A brief description of your story idea or tip</li>
              <li>Your contact information</li>
              <li>Any relevant details, photos, or background information</li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Editorial Process
            </h2>
            <p>
              All submissions are reviewed by our editorial team. We aim to respond to all submissions within one week. Please note that we receive many submissions and cannot guarantee publication of every story idea. We may edit submissions for clarity, length, and style to match our editorial standards.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Guidelines
            </h2>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Submissions should be relevant to Wedding or Berlin</li>
              <li>We welcome both serious and satirical content</li>
              <li>Please ensure all facts are accurate</li>
              <li>Respect privacy and obtain permission for any personal information</li>
            </ul>
          </section>

          <section className="pt-4 border-t border-[#e2e2e2]">
            <p className="font-sans text-sm text-[#666]">
              <strong className="font-semibold text-[#121212]">Note:</strong> The Wedding Times is a satirical publication. All published content is subject to our editorial review and may be edited for style, clarity, and satirical effect.
            </p>
          </section>
        </div>
      </article>
    </NytContainer>
  )
}
