import { getAllCities } from '@/lib/city/getAllCities'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import CityCard from '@/components/city/CityCard'
import type { City } from '@/lib/city/types'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cities',
  description: 'Browse anime pilgrimage routes by city.',
  alternates: { canonical: '/en/city' },
  openGraph: {
    type: 'website',
    url: '/en/city',
    title: 'Cities',
    description: 'Browse anime pilgrimage routes by city.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cities',
    description: 'Browse anime pilgrimage routes by city.',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

function matchesCity(postCity: string, city: City): boolean {
  const raw = String(postCity || '').trim()
  if (!raw) return false

  const lower = raw.toLowerCase()
  const candidates = [city.id, city.name_zh, city.name_en, city.name_ja]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .map((x) => x.toLowerCase())

  return candidates.includes(lower)
}

export default async function CityIndexEnPage() {
  const [cities, posts] = await Promise.all([getAllCities(), getAllPublicPosts('zh')])

  const counts = posts.reduce<Record<string, number>>((acc, p) => {
    for (const c of cities) {
      if (matchesCity(p.city, c)) {
        acc[c.id] = (acc[c.id] || 0) + 1
      }
    }
    return acc
  }, {})

  const sorted = [...cities].sort((a, b) => {
    const ca = counts[a.id] || 0
    const cb = counts[b.id] || 0
    if (ca !== cb) return cb - ca
    return a.id.localeCompare(b.id)
  })

  return (
    <div>
      <h1 className="text-2xl font-bold">Cities</h1>
      <div className="mt-2 text-sm text-gray-600">City hubs for discovery. Content is currently mostly in Chinese.</div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) => (
          <CityCard key={c.id} city={c} postCount={counts[c.id] || 0} />
        ))}
      </div>

      {!sorted.length ? <div className="mt-8 text-gray-500">No city metadata yet.</div> : null}
    </div>
  )
}
