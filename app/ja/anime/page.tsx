import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import { buildJaAlternates } from '@/lib/seo/alternates'
import AnimeCard from '@/components/anime/AnimeCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'アニメ聖地巡礼作品一覧｜作品別に巡礼ルートを探す',
  description:
    'アニメ聖地巡礼の作品別ガイド：実写ロケ地、巡礼ルート、スポットリスト、撮影のコツを集約した各作品ページで、日本のアニメツーリズムを計画できます。',
  alternates: buildJaAlternates({ zhPath: '/anime' }),
  openGraph: {
    type: 'website',
    url: '/ja/anime',
    title: 'アニメ聖地巡礼｜作品一覧',
    description:
      'アニメ聖地巡礼の作品別ガイド：実写ロケ地、巡礼ルート、スポットリスト、撮影のコツを集約した各作品ページで、日本のアニメツーリズムを計画できます。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'アニメ聖地巡礼｜作品一覧',
    description:
      'アニメ聖地巡礼の作品別ガイド：実写ロケ地、巡礼ルート、スポットリスト、撮影のコツを集約した各作品ページで、日本のアニメツーリズムを計画できます。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 3600
export const dynamic = 'force-static'

export default async function AnimeIndexJaPage() {
  const [anime, posts] = await Promise.all([getAllAnime(), getAllPublicPosts('ja')])
  const visiblePosts = posts.filter((p) => !isSeoSpokePost(p))
  const counts = visiblePosts.reduce<Record<string, number>>((acc, p) => {
    for (const id of p.animeIds || []) {
      acc[id] = (acc[id] || 0) + 1
    }
    return acc
  }, {})

  const coverFallback = new Map<string, string>()
  for (const p of visiblePosts) {
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
      <h1 className="text-2xl font-bold">アニメ</h1>
      <div className="mt-2 text-sm text-gray-600">インデックスページは日本語です。コンテンツの多くはまだ中国語です。</div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {sorted.map((a) => (
          <AnimeCard
            key={a.id}
            anime={a}
            postCount={counts[a.id] || 0}
            cover={a.cover || coverFallback.get(a.id) || null}
            locale="ja"
          />
        ))}
      </div>
      {!sorted.length ? <div className="mt-8 text-gray-500">アニメメタデータはまだありません。</div> : null}
    </div>
  )
}
