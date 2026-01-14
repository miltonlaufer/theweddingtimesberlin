import React from 'react'
import Link from 'next/link'

/******************* COMPONENT ***********************/

export default function OfflinePage() {
  /******************* COMPUTED ***********************/

  const messages = [
    'Telekom says the internet is working. Your browser says “nice try.”',
    'Deutsche Bahn WiFi is available in the same way unicorns are available.',
    'Your 5G signal has been downgraded to “strong vibes.”',
    'Berlin fiber rollout: coming soon, like every “soon” since 2014.',
    'This page is offline. So is half the city. Solidarity.',
    'Your connection is currently stuck in an endless Bürgeramt queue.',
    'Optic fiber has been installed… emotionally.',
    'The signal went into a tunnel. It may reappear in Brandenburg.',
    'Telekom support recommends turning Berlin off and on again.',
    'Deutsche Bahn WiFi connected successfully to disappointment.',
  ]

  /******************* RENDER ***********************/

  return (
    <main className="py-10 w-full">
      <div className="max-w-[680px] mx-auto px-5">
        <h1 className="font-headline text-3xl md:text-4xl font-bold text-[#121212]">
          You are offline
        </h1>
        <p className="mt-4 font-serif text-lg text-[#333] leading-relaxed">
          We couldn’t load the article from the network or cache. Here are your official German-internet excuses:
        </p>

        <ul className="mt-4 font-serif text-lg text-[#333] leading-relaxed list-disc pl-6 space-y-2">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>

        <div className="mt-8 flex items-center gap-4">
          <Link href="/" className="font-sans text-sm underline text-[#121212]">
            Back to home
          </Link>
          <span className="font-sans text-sm text-[#666]">Try again when the internet remembers it’s 2026.</span>
        </div>
      </div>
    </main>
  )
}

