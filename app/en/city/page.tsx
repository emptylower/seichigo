import { getCityCountsByLocale } from '@/lib/city/getCityCountsByLocale'
import { buildEnAlternates } from '@/lib/seo/alternates'
import CityCard from '@/components/city/CityCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cities — browse pilgrimage routes',
  description:
    'Browse anime pilgrimage routes by destination: explore city pages with spot lists, route summaries, and map navigation links to plan your trip efficiently.',
  alternates: buildEnAlternates({ zhPath: '/city' }),
  openGraph: {
    type: 'website',
    url: '/en/city',
    title: 'Cities',
    description:
      'Browse anime pilgrimage routes by destination: explore city pages with spot lists, route summaries, and map navigation links to plan your trip efficiently.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cities',
    description:
      'Browse anime pilgrimage routes by destination: explore city pages with spot lists, route summaries, and map navigation links to plan your trip efficiently.',
    images: ['/twitter-image'],
  },
}

export const revalidate = 3600
export const dynamic = 'force-static'

export default async function CityIndexEnPage() {
  const { cities, counts } = await getCityCountsByLocale('en')

  const sorted = [...cities].sort((a, b) => {
    const ca = counts[a.id] || 0
    const cb = counts[b.id] || 0
    if (ca !== cb) return cb - ca
    return a.slug.localeCompare(b.slug)
  })

  return (
    <div>
      <h1 className="text-2xl font-bold">Cities</h1>
      <div className="mt-2 text-sm text-gray-600">City hubs for discovery. Content is currently mostly in Chinese.</div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) => (
          <CityCard key={c.id} city={c} postCount={counts[c.id] || 0} locale="en" />
        ))}
      </div>

      {!sorted.length ? <div className="mt-8 text-gray-500">No city metadata yet.</div> : null}
    </div>
  )
}
