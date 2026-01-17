import React from 'react'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { getBaseUrl } from '@/lib/getBaseUrl'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'Terms of Service | The Wedding Times',
    description:
      'Read The Wedding Times terms of service to understand the rules and guidelines for using our website.',
    openGraph: {
      title: 'Terms of Service | The Wedding Times',
      description:
        'Read The Wedding Times terms of service to understand the rules and guidelines for using our website.',
      type: 'website',
      url: `${baseUrl}/terms`,
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

export default function TermsPage() {
  return (
    <NytContainer className="py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="font-headline text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-6">
          Terms of Service
        </h1>

        <div className="font-serif text-[17px] leading-[1.6] text-[#333] space-y-6">
          <p>
            Please read these Terms of Service carefully before using The Wedding Times website. By
            accessing or using our website, you agree to be bound by these terms.
          </p>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Acceptance of Terms
            </h2>
            <p>
              By accessing and using The Wedding Times website, you accept and agree to be bound by
              the terms and provision of this agreement. If you do not agree to abide by the above,
              please do not use this service.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Use License
            </h2>
            <p>
              Permission is granted to temporarily access and use The Wedding Times website for
              personal, non-commercial transitory viewing only. This is the grant of a license, not
              a transfer of title, and under this license you may not:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Modify or copy the materials</li>
              <li>Use the materials for any commercial purpose or for any public display</li>
              <li>Attempt to reverse engineer any software contained on the website</li>
              <li>Remove any copyright or other proprietary notations from the materials</li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Content Disclaimer
            </h2>
            <p>
              <strong className="font-semibold">Important:</strong> The Wedding Times is a satirical
              publication. All articles, stories, and characters appearing in this publication are
              fictitious. Any resemblance to real persons, living or dead, is purely coincidental
              and unintentional. Content is intended for entertainment purposes only.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              User Submissions
            </h2>
            <p>
              If you submit content to The Wedding Times, including but not limited to story tips,
              comments, or feedback, you grant us a non-exclusive, royalty-free, perpetual,
              irrevocable, and fully sublicensable right to use, reproduce, modify, adapt, publish,
              translate, create derivative works from, distribute, and display such content
              throughout the world in any media.
            </p>
            <p className="mt-2">
              You represent and warrant that any content you submit does not violate any third-party
              rights, including copyright, trademark, privacy, or other personal or proprietary
              rights.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Prohibited Uses
            </h2>
            <p>You agree not to use the website:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>In any way that violates any applicable law or regulation</li>
              <li>To transmit any malicious code, viruses, or harmful data</li>
              <li>
                To impersonate or attempt to impersonate The Wedding Times or any employee or
                affiliate
              </li>
              <li>
                To engage in any automated use of the system, such as scraping or data mining
                without permission
              </li>
              <li>To interfere with or disrupt the website or servers connected to the website</li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Disclaimer of Warranties
            </h2>
            <p>
              The materials on The Wedding Times website are provided on an &quot;as is&quot; basis.
              The Wedding Times makes no warranties, expressed or implied, and hereby disclaims and
              negates all other warranties including, without limitation, implied warranties or
              conditions of merchantability, fitness for a particular purpose, or non-infringement
              of intellectual property or other violation of rights.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Limitations of Liability
            </h2>
            <p>
              In no event shall The Wedding Times or its suppliers be liable for any damages
              (including, without limitation, damages for loss of data or profit, or due to business
              interruption) arising out of the use or inability to use the materials on The Wedding
              Times website, even if The Wedding Times or an authorized representative has been
              notified orally or in writing of the possibility of such damage.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Revisions and Errata
            </h2>
            <p>
              The materials appearing on The Wedding Times website could include technical,
              typographical, or photographic errors. The Wedding Times does not warrant that any of
              the materials on its website are accurate, complete, or current. We may make changes
              to the materials contained on its website at any time without notice.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Changes to Terms
            </h2>
            <p>
              The Wedding Times may revise these terms of service at any time without notice. By
              using this website, you are agreeing to be bound by the then current version of these
              terms of service.
            </p>
          </section>

          <section className="pt-4 border-t border-[#e2e2e2]">
            <p className="font-sans text-sm text-[#666]">
              <strong className="font-semibold text-[#121212]">Last Updated:</strong> These terms of
              service were last updated on{' '}
              {new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
              .
            </p>
            <p className="font-sans text-sm text-[#666] mt-2">
              If you have any questions about these Terms of Service, please{' '}
              <a href="/contact" className="text-[#121212] underline hover:text-[#555]">
                contact us
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </NytContainer>
  )
}
