import { pageCardImage } from '@/lib/og/pageCardUrl'
import { getCityCountsByLocale } from '@/lib/city/getCityCountsByLocale'
import { buildEnAlternates } from '@/lib/seo/alternates'
import { t } from '@/lib/i18n'
import CityCard from '@/components/city/CityCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pilgrimage Cities | Anime Travel by Destination in Japan',
  description:
    'Explore anime pilgrimage routes by Japan travel destination: city pages with filming locations, route summaries, and map navigation links to plan your anime tourism trip efficiently.',
  alternates: buildEnAlternates({ zhPath: '/city' }),
  openGraph: {
    type: 'website',
    url: '/en/city',
    title: 'Pilgrimage Cities | Anime Travel by Destination in Japan',
    description:
      'Explore anime pilgrimage routes by Japan travel destination: city pages with filming locations, route summaries, and map navigation links to plan your anime tourism trip efficiently.',
    images: [pageCardImage('site', 'home', 'en', 'SeichiGo Anime Pilgrimage')],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pilgrimage Cities | Anime Travel by Destination in Japan',
    description:
      'Explore anime pilgrimage routes by Japan travel destination: city pages with filming locations, route summaries, and map navigation links to plan your anime tourism trip efficiently.',
    images: [pageCardImage('site', 'home', 'en', 'SeichiGo Anime Pilgrimage')],
  },
}

export const revalidate = 300
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
      <h1 className="text-2xl font-bold">{t('header.city', 'en')}</h1>
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
