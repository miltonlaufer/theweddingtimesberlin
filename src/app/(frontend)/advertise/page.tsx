import React from 'react'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { getBaseUrl } from '@/lib/getBaseUrl'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'Advertise | The Wedding Times',
    description: 'Advertising opportunities with The Wedding Times. Reach Wedding residents and Berliners through our satirical publication.',
    openGraph: {
      title: 'Advertise | The Wedding Times',
      description: 'Advertising opportunities with The Wedding Times. Reach Wedding residents and Berliners through our satirical publication.',
      type: 'website',
      url: `${baseUrl}/advertise`,
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

export default function AdvertisePage() {
  return (
    <NytContainer className="py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="font-headline text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-6">
          Advertise With Us
        </h1>

        <div className="font-serif text-[17px] leading-[1.6] text-[#333] space-y-6">
          <p>
            The Wedding Times offers unique advertising opportunities to reach an engaged audience of Wedding residents and Berliners who appreciate quality journalism and satire.
          </p>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Why Advertise With The Wedding Times?
            </h2>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li>Reach a dedicated readership of Wedding neighbourhood residents and Berliners</li>
              <li>Connect with an audience that values local news and community engagement</li>
              <li>Support independent journalism and satirical content</li>
              <li>Multiple advertising formats available to suit your needs</li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Advertising Options
            </h2>
            <p>
              We offer various advertising formats including banner ads, sponsored content, and newsletter placements. Our team can work with you to create a custom advertising package that fits your budget and goals.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Get Started
            </h2>
            <p>
              Interested in advertising with us? Please contact us through our{' '}
              <a href="/contact" className="text-[#121212] underline hover:text-[#555]">
                Contact Us
              </a>{' '}
              page with your advertising inquiry. Include information about your business, target audience, and advertising goals, and we&apos;ll get back to you with a custom proposal.
            </p>
          </section>

          <section className="pt-4 border-t border-[#e2e2e2]">
            <p className="font-sans text-sm text-[#666]">
              <strong className="font-semibold text-[#121212]">Note:</strong> We reserve the right to decline advertising that conflicts with our editorial values or community standards.
            </p>
          </section>
        </div>
      </article>
    </NytContainer>
  )
}
