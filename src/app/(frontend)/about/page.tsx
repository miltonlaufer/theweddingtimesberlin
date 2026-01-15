import React from 'react'
import type { Metadata } from 'next'
import { NytContainer } from '@/components/NytContainer'
import { getBaseUrl } from '@/lib/getBaseUrl'

/******************* METADATA ***********************/

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl()
  const logoUrl = `${baseUrl}/logo-200x200.png`

  return {
    title: 'About | The Wedding Times',
    description: 'Learn about The Wedding Times, Berlin\'s premier satirical neighbourhood publication covering Wedding.',
    openGraph: {
      title: 'About | The Wedding Times',
      description: 'Learn about The Wedding Times, Berlin\'s premier satirical neighbourhood publication covering Wedding.',
      type: 'website',
      url: `${baseUrl}/about`,
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

export default function AboutPage() {
  return (
    <NytContainer className="py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="font-headline text-[48px] font-bold leading-[1.1] tracking-[-0.02em] text-[#121212] mb-6">
          About The Wedding Times
        </h1>

        <div className="font-serif text-[17px] leading-[1.6] text-[#333] space-y-4">
          <p>
            The Wedding Times is a satirical publication dedicated to covering the news, culture, and daily life of Berlin&apos;s Wedding neighbourhood. Founded with a commitment to journalistic excellence (and a healthy dose of humour), we bring you all the news that&apos;s fit to print—and some that isn&apos;t.
          </p>

          <p>
            Our mission is to provide Wedding residents and Berliners at large with a unique perspective on neighbourhood happenings, from the bureaucratic absurdities of the Bürgeramt to the latest developments on Leopoldplatz, from gentrification debates to the best Späti reviews.
          </p>

          <p>
            We cover a wide range of topics including local news, opinion pieces, food and drink, nightlife, transportation updates, and the everyday experiences that make Wedding the vibrant neighbourhood it is.
          </p>

          <p>
            <strong className="font-semibold">Important Disclaimer:</strong> The Wedding Times is a satirical publication. All articles, stories, and characters appearing in this publication are fictitious. Any resemblance to real persons, living or dead, is purely coincidental and unintentional. No actual Wedding residents were harmed in the making of this publication.
          </p>

          <p>
            We believe in the power of satire to illuminate truth, spark conversation, and bring communities together—even if that means poking a little fun at ourselves along the way.
          </p>
        </div>
      </article>
    </NytContainer>
  )
}
