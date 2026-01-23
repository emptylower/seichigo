import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { buildEnAlternates } from '@/lib/seo/alternates'
import AnimeCard from '@/components/anime/AnimeCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Anime Index',
  description: 'Browse published pilgrimage routes and posts by anime work.',
  alternates: buildEnAlternates({ zhPath: '/anime' }),
  openGraph: {
    type: 'website',
    url: '/en/anime',
    title: 'Anime Index',
    description: 'Browse published pilgrimage routes and posts by anime work.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Anime Index',
    description: 'Browse published pilgrimage routes and posts by anime work.',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default async function AnimeIndexEnPage() {
  const [anime, posts] = await Promise.all([getAllAnime(), getAllPublicPosts('zh')])
  const counts = posts.reduce<Record<string, number>>((acc, p) => {
    for (const id of p.animeIds || []) {
      acc[id] = (acc[id] || 0) + 1
    }
    return acc
  }, {})

  const coverFallback = new Map<string, string>()
  for (const p of posts) {
    if (!p.cover) continue
    for (const id of p.animeIds || []) {
      if (!coverFallback.has(id)) {
        coverFallback.set(id, p.cover)
      }
    }
  }

  const sorted = [...anime].sort((a, b) => {
    const ca = counts[a.id] || 0
    const cb = counts[b.id] || 0
    if (ca !== cb) return cb - ca
    const ya = a.year || 0
    const yb = b.year || 0
    if (ya !== yb) return yb - ya
    return a.name.localeCompare(b.name)
  })

  return (
    <div>
      <h1 className="text-2xl font-bold">Anime</h1>
      <div className="mt-2 text-sm text-gray-600">Index pages are in English; most content is still in Chinese.</div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {sorted.map((a) => (
          <AnimeCard
            key={a.id}
            anime={a}
            postCount={counts[a.id] || 0}
            cover={a.cover || coverFallback.get(a.id) || null}
          />
        ))}
      </div>
      {!sorted.length ? <div className="mt-8 text-gray-500">No anime metadata yet.</div> : null}
    </div>
  )
}
