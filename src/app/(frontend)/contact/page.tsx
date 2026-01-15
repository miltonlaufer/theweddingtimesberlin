import React from 'react'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { getBaseUrl } from '@/lib/getBaseUrl'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'Contact Us | The Wedding Times',
    description: 'Get in touch with The Wedding Times. We welcome your feedback, story tips, and inquiries.',
    openGraph: {
      title: 'Contact Us | The Wedding Times',
      description: 'Get in touch with The Wedding Times. We welcome your feedback, story tips, and inquiries.',
      type: 'website',
      url: `${baseUrl}/contact`,
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

export default function ContactPage() {
  return (
    <NytContainer className="py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="font-headline text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-6">
          Contact Us
        </h1>

        <div className="font-serif text-[17px] leading-[1.6] text-[#333] space-y-6">
          <p>
            We&apos;d love to hear from you! Whether you have a story tip, feedback, a correction, or just want to say hello, we&apos;re here to listen.
          </p>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              General Inquiries
            </h2>
            <p>
              For general questions, feedback, or inquiries, please reach out to us through our editorial team. We aim to respond to all messages within 48 hours.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Story Tips
            </h2>
            <p>
              Have a story idea or tip? We welcome submissions from Wedding residents and Berliners who have interesting stories to share. Please use our{' '}
              <a href="/submit" className="text-[#121212] underline hover:text-[#555]">
                Submit a Story
              </a>{' '}
              page to send us your ideas.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Corrections
            </h2>
            <p>
              We strive for accuracy in all our reporting. If you notice an error, please let us know through our{' '}
              <a href="/corrections" className="text-[#121212] underline hover:text-[#555]">
                Corrections
              </a>{' '}
              page.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Advertising
            </h2>
            <p>
              Interested in advertising with us? Visit our{' '}
              <a href="/advertise" className="text-[#121212] underline hover:text-[#555]">
                Advertise
              </a>{' '}
              page for more information about advertising opportunities.
            </p>
          </section>

          <section className="pt-4 border-t border-[#e2e2e2]">
            <p className="font-sans text-sm text-[#666]">
              <strong className="font-semibold text-[#121212]">Note:</strong> The Wedding Times is a satirical publication. All content is intended for entertainment purposes.
            </p>
          </section>
        </div>
      </article>
    </NytContainer>
  )
}
