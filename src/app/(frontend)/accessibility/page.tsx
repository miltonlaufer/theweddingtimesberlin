import React from 'react'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { getBaseUrl } from '@/lib/getBaseUrl'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'Accessibility | The Wedding Times',
    description:
      'The Wedding Times is committed to making our website accessible to all users. Learn about our accessibility features and standards.',
    openGraph: {
      title: 'Accessibility | The Wedding Times',
      description:
        'The Wedding Times is committed to making our website accessible to all users. Learn about our accessibility features and standards.',
      type: 'website',
      url: `${baseUrl}/accessibility`,
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

export default function AccessibilityPage() {
  return (
    <NytContainer className="py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="font-headline text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-6">
          Accessibility
        </h1>

        <div className="font-serif text-[17px] leading-[1.6] text-[#333] space-y-6">
          <p>
            The Wedding Times is committed to ensuring digital accessibility for people with
            disabilities. We are continually improving the user experience for everyone and applying
            the relevant accessibility standards to achieve these goals.
          </p>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Our Commitment
            </h2>
            <p>
              We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 level AA
              standards. These guidelines explain how to make web content more accessible for people
              with disabilities, and user-friendly for everyone.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Accessibility Features
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="font-semibold">Semantic HTML:</strong> We use proper HTML
                structure and semantic elements to ensure content is accessible to screen readers
                and other assistive technologies.
              </li>
              <li>
                <strong className="font-semibold">Keyboard Navigation:</strong> Our website can be
                navigated using only a keyboard, without requiring a mouse.
              </li>
              <li>
                <strong className="font-semibold">Alt Text:</strong> Images include descriptive alt
                text to provide context for users who cannot see them.
              </li>
              <li>
                <strong className="font-semibold">Color Contrast:</strong> We maintain sufficient
                color contrast ratios to ensure text is readable for users with visual impairments.
              </li>
              <li>
                <strong className="font-semibold">Responsive Design:</strong> Our website is
                designed to work across different devices and screen sizes.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Feedback
            </h2>
            <p>
              We welcome your feedback on the accessibility of The Wedding Times website. If you
              encounter any accessibility barriers, please{' '}
              <a href="/contact" className="text-[#121212] underline hover:text-[#555]">
                contact us
              </a>
              . We will make every effort to address your concerns and improve our accessibility
              standards.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Ongoing Improvements
            </h2>
            <p>
              We are continuously working to improve the accessibility of our website. This includes
              regular audits, user testing, and implementing feedback from our community. We
              recognize that accessibility is an ongoing process and are committed to making our
              content available to all users.
            </p>
          </section>

          <section className="pt-4 border-t border-[#e2e2e2]">
            <p className="font-sans text-sm text-[#666]">
              <strong className="font-semibold text-[#121212]">Last Updated:</strong> This
              accessibility statement was last updated on{' '}
              {new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
              .
            </p>
          </section>
        </div>
      </article>
    </NytContainer>
  )
}
