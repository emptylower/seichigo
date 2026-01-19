import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'SeichiGo — Anime Pilgrimage Guides' },
  description: 'Long-form anime pilgrimage guides with practical spot lists, route maps, and photography tips.',
  alternates: { canonical: '/en' },
  openGraph: {
    type: 'website',
    url: '/en',
    title: 'SeichiGo — Anime Pilgrimage Guides',
    description: 'Long-form anime pilgrimage guides with practical spot lists, route maps, and photography tips.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGo — Anime Pilgrimage Guides',
    description: 'Long-form anime pilgrimage guides with practical spot lists, route maps, and photography tips.',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default function EnglishHomePage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-5xl">Anime Pilgrimage Guides</h1>
        <p className="max-w-2xl text-sm text-gray-600 md:text-base">
          Practical routes, spot checklists, and map entry points. English pages are rolling out gradually.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/en/anime" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">Browse by Anime</div>
          <div className="mt-1 text-sm text-gray-700">Works hub pages with associated routes.</div>
        </Link>
        <Link href="/en/city" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">Browse by City</div>
          <div className="mt-1 text-sm text-gray-700">City hubs for long-tail discovery.</div>
        </Link>
        <Link href="/en/resources" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">Resources</div>
          <div className="mt-1 text-sm text-gray-700">Maps, checklists, and etiquette pages.</div>
        </Link>
        <Link href="/" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">Switch to Chinese</div>
          <div className="mt-1 text-sm text-gray-700">Read the current full catalog in Chinese.</div>
        </Link>
      </div>
    </div>
  )
}
