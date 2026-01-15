import React from 'react'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { getBaseUrl } from '@/lib/getBaseUrl'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'Corrections | The Wedding Times',
    description: 'Report corrections and errors to The Wedding Times. We are committed to accuracy in our reporting.',
    openGraph: {
      title: 'Corrections | The Wedding Times',
      description: 'Report corrections and errors to The Wedding Times. We are committed to accuracy in our reporting.',
      type: 'website',
      url: `${baseUrl}/corrections`,
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

export default function CorrectionsPage() {
  return (
    <NytContainer className="py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="font-headline text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-6">
          Corrections
        </h1>

        <div className="font-serif text-[17px] leading-[1.6] text-[#333] space-y-6">
          <p>
            The Wedding Times is committed to accuracy in our reporting. While we strive to get every detail right, we recognize that errors can occur. If you notice a factual error, misstatement, or inaccuracy in any of our articles, we want to hear from you.
          </p>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              How to Report a Correction
            </h2>
            <p>
              Please contact us through our{' '}
              <a href="/contact" className="text-[#121212] underline hover:text-[#555]">
                Contact Us
              </a>{' '}
              page with the following information:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
              <li>The article title and publication date</li>
              <li>The specific error or inaccuracy</li>
              <li>The correct information</li>
              <li>Any supporting documentation or sources</li>
              <li>Your contact information (optional, but helpful if we need to follow up)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Our Correction Policy
            </h2>
            <p>
              When we confirm an error, we will:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
              <li>Correct the error promptly in the online version of the article</li>
              <li>Add a correction notice to the article when appropriate</li>
              <li>Maintain transparency about what was corrected and when</li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              What We Correct
            </h2>
            <p>
              We correct factual errors, misstatements, and inaccuracies. This includes:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
              <li>Incorrect names, dates, or locations</li>
              <li>Factual misstatements</li>
              <li>Misquotes or misattributions</li>
              <li>Errors in numbers, statistics, or data</li>
            </ul>
            <p className="mt-3">
              Please note that we do not correct matters of opinion, interpretation, or satirical content that is clearly marked as such.
            </p>
          </section>

          <section className="pt-4 border-t border-[#e2e2e2]">
            <p className="font-sans text-sm text-[#666]">
              <strong className="font-semibold text-[#121212]">Note:</strong> The Wedding Times is a satirical publication. Satirical content, clearly marked as such, is not subject to factual correction. We appreciate your understanding and your help in maintaining our standards of accuracy.
            </p>
          </section>
        </div>
      </article>
    </NytContainer>
  )
}
