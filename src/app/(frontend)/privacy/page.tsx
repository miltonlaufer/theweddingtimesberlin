import React from 'react'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { getBaseUrl } from '@/lib/getBaseUrl'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'Privacy Policy | The Wedding Times',
    description:
      'Read The Wedding Times privacy policy to understand how we collect, use, and protect your personal information.',
    openGraph: {
      title: 'Privacy Policy | The Wedding Times',
      description:
        'Read The Wedding Times privacy policy to understand how we collect, use, and protect your personal information.',
      type: 'website',
      url: `${baseUrl}/privacy`,
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

export default function PrivacyPage() {
  return (
    <NytContainer className="py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="font-headline text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-6">
          Privacy Policy
        </h1>

        <div className="font-serif text-[17px] leading-[1.6] text-[#333] space-y-6">
          <p>
            At The Wedding Times, we respect your privacy and are committed to protecting your
            personal data. This privacy policy explains how we collect, use, and safeguard your
            information when you visit our website.
          </p>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Information We Collect
            </h2>
            <p>We may collect the following types of information:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                <strong className="font-semibold">Usage Data:</strong> We collect information about
                how you interact with our website, including pages visited, time spent on pages, and
                referring websites. This data is collected through analytics tools and helps us
                improve our content and user experience.
              </li>
              <li>
                <strong className="font-semibold">Device Information:</strong> We may collect
                information about your device, including browser type, operating system, and IP
                address.
              </li>
              <li>
                <strong className="font-semibold">Voluntary Information:</strong> If you contact us
                or submit content, we may collect the information you voluntarily provide, such as
                your name, email address, and message content.
              </li>
              <li>
                <strong className="font-semibold">Push Notifications:</strong> If you subscribe to
                push notifications, we store your subscription information to deliver notifications
                to your device.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              How We Use Your Information
            </h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Provide, maintain, and improve our website and services</li>
              <li>Analyze website usage and trends to enhance user experience</li>
              <li>Respond to your inquiries and feedback</li>
              <li>Send push notifications (if you have subscribed)</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Cookies and Tracking Technologies
            </h2>
            <p>
              We use cookies and similar tracking technologies to track activity on our website and
              store certain information. You can instruct your browser to refuse all cookies or to
              indicate when a cookie is being sent. However, if you do not accept cookies, you may
              not be able to use some portions of our website.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Third-Party Services
            </h2>
            <p>
              We may use third-party services (such as analytics providers) that collect, monitor,
              and analyze website usage. These third parties have their own privacy policies
              addressing how they use such information.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Data Security
            </h2>
            <p>
              We implement appropriate technical and organizational measures to protect your
              personal data against unauthorized access, alteration, disclosure, or destruction.
              However, no method of transmission over the Internet or electronic storage is 100%
              secure.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Your Rights
            </h2>
            <p>
              Depending on your location, you may have certain rights regarding your personal data,
              including the right to access, correct, or delete your information. If you wish to
              exercise these rights, please{' '}
              <a href="/contact" className="text-[#121212] underline hover:text-[#555]">
                contact us
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Children&apos;s Privacy
            </h2>
            <p>
              Our website is not intended for children under the age of 13. We do not knowingly
              collect personal information from children under 13. If you are a parent or guardian
              and believe your child has provided us with personal information, please contact us.
            </p>
          </section>

          <section>
            <h2 className="font-headline text-[28px] font-bold leading-[1.2] text-[#121212] mb-3">
              Changes to This Privacy Policy
            </h2>
            <p>
              We may update our Privacy Policy from time to time. We will notify you of any changes
              by posting the new Privacy Policy on this page and updating the &quot;Last
              Updated&quot; date.
            </p>
          </section>

          <section className="pt-4 border-t border-[#e2e2e2]">
            <p className="font-sans text-sm text-[#666]">
              <strong className="font-semibold text-[#121212]">Last Updated:</strong> This privacy
              policy was last updated on{' '}
              {new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
              .
            </p>
            <p className="font-sans text-sm text-[#666] mt-2">
              If you have any questions about this Privacy Policy, please{' '}
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
