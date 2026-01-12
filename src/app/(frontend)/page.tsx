'use client'

import React, { useEffect, useMemo } from 'react'
import { observer } from 'mobx-react-lite'
import Link from 'next/link'
import Image from 'next/image'
import { useArticleStore } from '@/stores'
import type { IArticle } from '@/types/article'

/******************* MOCK DATA ***********************/

const mockArticles: IArticle[] = [
  {
    id: '1',
    headline: 'Standesamt Appointment Secured for 2027; Couple "Cautiously Optimistic"',
    subheadline: 'After 18 months on the waiting list, Berlin bureaucracy delivers another victory for patience',
    slug: 'standesamt-appointment-2027',
    featuredImageUrl: 'https://picsum.photos/seed/berlin1/800/600',
    imageCaption: 'Klaus Weber/The Wedding Times',
    content: '<p>Full article content here...</p>',
    excerpt:
      'Local couple Stefan and Maria have finally received confirmation of their civil wedding appointment at Standesamt Mitte, scheduled for March 2027. "We started dating in 2019, so really this is moving quite fast by Berlin standards," said Stefan, visibly emotional.',
    category: { id: 'c1', name: 'Bureaucracy', slug: 'bureaucracy', description: '', order: 0 },
    author: {
      id: 'a1',
      name: 'Helga Zimmermann',
      slug: 'helga-zimmermann',
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
    headline: 'Wedding Guest From Schwabia Complains Berlin "Too Dirty" While Standing in Own Vomit',
    subheadline: 'Incident occurred at 4 AM outside Berghain after guest was denied entry for the third time',
    slug: 'schwabian-guest-dirty',
    featuredImageUrl: 'https://picsum.photos/seed/berlin2/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'A wedding guest from Stuttgart spent forty-five minutes lecturing locals about Berlin\'s cleanliness standards while standing ankle-deep in his own Jaegermeister-induced emissions. "In Schwabia, we would never tolerate this," he reportedly said, gesturing at a nearby kebab wrapper.',
    category: { id: 'c2', name: 'Reception', slug: 'reception', description: '', order: 1 },
    author: { id: 'a2', name: 'Hans-Peter Mueller', slug: 'hans-peter-mueller', title: 'Society Editor' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: true,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '3',
    headline: "Bride's Uncle From Neukoelln Offers to 'Handle' Groom's Family Dispute",
    slug: 'uncle-neukoelln-handle',
    featuredImageUrl: 'https://picsum.photos/seed/berlin3/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'Tensions rose during the rehearsal dinner when the bride\'s uncle, a long-time Neukoelln resident, offered to resolve a seating arrangement disagreement "the old-fashioned way." He was later seen making phone calls in the parking lot.',
    category: { id: 'c3', name: 'Family Drama', slug: 'family', description: '', order: 2 },
    author: { id: 'a3', name: 'Fatima El-Rashid', slug: 'fatima-rashid', title: 'Family Affairs Analyst' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: true,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '4',
    headline: 'Prenzlauer Berg Mother Insists Her Child Is "Too Gifted" for Ring Bearer Role',
    slug: 'prenzlauer-berg-gifted-child',
    content: '<p>Full article content here...</p>',
    excerpt:
      'Local mother of a 4-year-old has declined the ring bearer position, explaining that little Konstantin-Amadeus is "already reading Nietzsche in the original German" and would find the task "intellectually unstimulating."',
    category: { id: 'c4', name: 'Opinion', slug: 'opinion', description: '', order: 3 },
    author: { id: 'a4', name: 'Friedrich Schulze', slug: 'friedrich-schulze', title: 'Opinion Columnist' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'opinion',
  },
  {
    id: '5',
    headline: "DJ's 6-Hour Techno Set Leaves Elderly Guests 'Forever Changed'",
    slug: 'techno-dj-elderly',
    featuredImageUrl: 'https://picsum.photos/seed/berlin5/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'What began as a traditional wedding reception transformed into an impromptu Tresor tribute when the DJ refused to play anything recorded after 1997. Grandmother Ingrid, 84, was last seen demanding "more bass."',
    category: { id: 'c2', name: 'Reception', slug: 'reception', description: '', order: 1 },
    author: { id: 'a1', name: 'Helga Zimmermann', slug: 'helga-zimmermann' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '6',
    headline: 'Man Found Unconscious in Wedding Venue Bathroom Claims He "Just Got Here"',
    slug: 'bathroom-unconscious-guest',
    featuredImageUrl: 'https://picsum.photos/seed/berlin6/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'A guest discovered passed out in the bathroom stall at 3 AM insisted he had "only just arrived" and "barely had anything to drink." Security footage shows him entering the venue at 6 PM with two bottles of Sternburg.',
    category: { id: 'c3', name: 'Reception', slug: 'reception', description: '', order: 2 },
    author: { id: 'a3', name: 'Fatima El-Rashid', slug: 'fatima-rashid' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '7',
    headline: 'Caterer Insists Doener Kebab Tower Is "Elevated German Cuisine"',
    slug: 'doener-tower-cuisine',
    content: '<p>Full article content here...</p>',
    excerpt:
      'The wedding caterer defended his decision to replace the traditional wedding cake with a 12-tier Doener construction, calling it "a commentary on Berlin\'s multicultural identity and also really delicious at 4 AM."',
    category: { id: 'c5', name: 'Food & Drink', slug: 'food-drink', description: '', order: 4 },
    author: { id: 'a2', name: 'Hans-Peter Mueller', slug: 'hans-peter-mueller' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'standard',
  },
  {
    id: '8',
    headline: 'Wedding Officiant Still Waiting for Anmeldung Appointment to Legally Exist',
    slug: 'officiant-anmeldung',
    featuredImageUrl: 'https://picsum.photos/seed/berlin8/800/600',
    content: '<p>Full article content here...</p>',
    excerpt:
      'The wedding has been postponed indefinitely after it emerged the officiant, a recent Berlin transplant, has been unable to register his address since moving here in 2021. "I\'ve tried 47 times," he said, refreshing the Buergeramt website.',
    category: { id: 'c6', name: 'Bureaucracy', slug: 'bureaucracy', description: '', order: 5 },
    author: { id: 'a4', name: 'Friedrich Schulze', slug: 'friedrich-schulze' },
    publishedAt: new Date().toISOString(),
    status: 'published',
    isFeatured: false,
    isHeadline: false,
    layout: 'standard',
  },
]

/******************* STYLES ***********************/

const styles = {
  headlineImage: {
    position: 'relative' as const,
    aspectRatio: '16/10',
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  imageCaption: {
    fontFamily: 'var(--font-sans)',
    fontSize: '11px',
    color: 'var(--color-ink-lighter)',
    textAlign: 'right' as const,
    marginTop: '4px',
  },
  mainHeadline: {
    fontFamily: 'var(--font-headline)',
    fontSize: '28px',
    fontWeight: 700,
    color: 'var(--color-ink)',
    lineHeight: 1.15,
    margin: '12px 0 0 0',
  },
  mainSubheadline: {
    fontFamily: 'var(--font-body)',
    fontSize: '16px',
    color: 'var(--color-ink-light)',
    lineHeight: 1.5,
    marginTop: '8px',
  },
  articleHeadline: {
    fontFamily: 'var(--font-headline)',
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--color-ink)',
    lineHeight: 1.2,
    margin: 0,
  },
  articleExcerpt: {
    fontFamily: 'var(--font-body)',
    fontSize: '15px',
    color: 'var(--color-ink-light)',
    lineHeight: 1.5,
    marginTop: '8px',
  },
  readTime: {
    fontFamily: 'var(--font-sans)',
    fontSize: '11px',
    color: 'var(--color-ink-lighter)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginTop: '8px',
  },
  articleItem: {
    paddingBottom: '20px',
    marginBottom: '20px',
    borderBottom: '1px solid var(--color-rule)',
  },
  articleItemLast: {
    paddingBottom: '20px',
    marginBottom: '0',
  },
  articleHeadlineSmall: {
    fontFamily: 'var(--font-headline)',
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--color-ink)',
    lineHeight: 1.2,
    margin: 0,
  },
  articleExcerptSmall: {
    fontFamily: 'var(--font-body)',
    fontSize: '14px',
    color: 'var(--color-ink-light)',
    lineHeight: 1.5,
    marginTop: '6px',
  },
  thumbnailWrapper: {
    position: 'relative' as const,
    width: '100px',
    height: '70px',
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
    flexShrink: 0,
  },
  opinionSection: {
    marginTop: '32px',
    paddingTop: '16px',
    borderTop: '2px solid var(--color-ink)',
  },
  sectionTitle: {
    fontFamily: 'var(--font-headline)',
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--color-ink)',
    marginBottom: '16px',
  },
  authorName: {
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--color-ink)',
    textTransform: 'uppercase' as const,
    marginBottom: '4px',
  },
}

/******************* HOMEPAGE COMPONENT ***********************/

const HomePage: React.FC = observer(function HomePage() {
  /******************* STORE ***********************/

  const articleStore = useArticleStore()

  /******************* COMPUTED ***********************/

  const headlineArticle = useMemo(() => mockArticles.find((a) => a.isHeadline), [])
  const leftColumnArticles = useMemo(() => mockArticles.filter((a) => !a.isHeadline).slice(0, 3), [])
  const rightColumnArticles = useMemo(() => mockArticles.filter((a) => !a.isHeadline).slice(3, 7), [])
  const opinionArticles = useMemo(() => mockArticles.filter((a) => a.category.slug === 'opinion'), [])

  /******************* EFFECTS ***********************/

  useEffect(() => {
    // articleStore.fetchAll()
  }, [articleStore])

  /******************* RENDER ***********************/

  return (
    <div className="homepage-container">
      {/* Main 3-column grid */}
      <div className="main-grid">
        {/* Center Column - Main headline with image (shown first on mobile) */}
        <div className="center-column">
          {headlineArticle && (
            <article>
              {headlineArticle.featuredImageUrl && (
                <Link href={`/article/${headlineArticle.slug}`}>
                  <div style={styles.headlineImage}>
                    <Image
                      src={headlineArticle.featuredImageUrl}
                      alt={headlineArticle.headline}
                      fill
                      style={{ objectFit: 'cover' }}
                      sizes="(max-width: 768px) 100vw, 50vw"
                      priority
                    />
                  </div>
                  <p style={styles.imageCaption}>{headlineArticle.imageCaption}</p>
                </Link>
              )}
              <Link href={`/article/${headlineArticle.slug}`}>
                <h2 style={styles.mainHeadline}>{headlineArticle.headline}</h2>
              </Link>
              <p style={styles.mainSubheadline}>{headlineArticle.subheadline}</p>
            </article>
          )}
        </div>

        {/* Left Column - Text-only articles */}
        <div className="left-column">
          {leftColumnArticles.map((article, index) => (
            <article
              key={article.id}
              style={index < leftColumnArticles.length - 1 ? styles.articleItem : styles.articleItemLast}
            >
              <Link href={`/article/${article.slug}`}>
                <h3 style={styles.articleHeadline}>{article.headline}</h3>
              </Link>
              <p style={styles.articleExcerpt}>{article.excerpt}</p>
              <p style={styles.readTime}>4 min read</p>
            </article>
          ))}
        </div>

        {/* Right Column - Featured articles with thumbnails */}
        <div className="right-column">
          {rightColumnArticles.map((article, index) => (
            <article
              key={article.id}
              style={{
                display: index < 2 ? 'flex' : 'block',
                gap: '12px',
                paddingBottom: '16px',
                marginBottom: '16px',
                borderBottom: index < rightColumnArticles.length - 1 ? '1px solid var(--color-rule)' : 'none',
              }}
            >
              <div style={{ flex: 1 }}>
                <Link href={`/article/${article.slug}`}>
                  <h3 style={styles.articleHeadlineSmall}>{article.headline}</h3>
                </Link>
                <p style={styles.articleExcerptSmall}>{article.excerpt}</p>
                <p style={styles.readTime}>5 min read</p>
              </div>
              {index < 2 && article.featuredImageUrl && (
                <Link href={`/article/${article.slug}`}>
                  <div style={styles.thumbnailWrapper}>
                    <Image
                      src={article.featuredImageUrl}
                      alt={article.headline}
                      fill
                      style={{ objectFit: 'cover' }}
                      sizes="120px"
                    />
                  </div>
                </Link>
              )}
            </article>
          ))}
        </div>
      </div>

      {/* Opinion Section */}
      {opinionArticles.length > 0 && (
        <section style={styles.opinionSection}>
          <h2 style={styles.sectionTitle}>Opinion</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px' }}>
            {opinionArticles.map((article) => (
              <article key={article.id}>
                <p style={styles.authorName}>{article.author.name}</p>
                <Link href={`/article/${article.slug}`}>
                  <h3 style={styles.articleHeadlineSmall}>{article.headline}</h3>
                </Link>
                <p style={styles.articleExcerptSmall}>{article.excerpt}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
})

export default HomePage
