import type { Metadata } from 'next'
import Link from 'next/link'
import { buildEnAlternates } from '@/lib/seo/alternates'

export const metadata: Metadata = {
  title: 'About SeichiGo',
  description: 'SeichiGo publishes long-form anime pilgrimage guides with practical routes and spot lists.',
  alternates: buildEnAlternates({ zhPath: '/about' }),
  openGraph: {
    type: 'website',
    url: '/en/about',
    title: 'About SeichiGo',
    description: 'SeichiGo publishes long-form anime pilgrimage guides with practical routes and spot lists.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About SeichiGo',
    description: 'SeichiGo publishes long-form anime pilgrimage guides with practical routes and spot lists.',
    images: ['/twitter-image'],
  },
}

export default function AboutEnPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-5xl">About SeichiGo</h1>
        <p className="max-w-2xl text-sm text-gray-600 md:text-base">
          SeichiGo focuses on "one anime x one route" guides with spot lists, navigation links, and photography tips.
          English pages are expanding gradually.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/anime" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">Browse in Chinese</div>
          <div className="mt-1 text-sm text-gray-700">The full catalog is currently in Chinese.</div>
        </Link>
        <Link href="/about" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">Read the Chinese About</div>
          <div className="mt-1 text-sm text-gray-700">More background and contact information.</div>
        </Link>
      </div>
    </div>
  )
}
