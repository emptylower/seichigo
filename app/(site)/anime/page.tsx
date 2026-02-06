import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import { buildZhAlternates } from '@/lib/seo/alternates'
import AnimeCard from '@/components/anime/AnimeCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '作品索引｜按动画作品浏览圣地巡礼',
  description:
    '按动画作品浏览已发布的圣地巡礼路线与文章：汇总每部作品的取景地清单、机位建议与路线导航入口，适合用来快速挑选目的地并开始规划行程。',
  alternates: buildZhAlternates({ path: '/anime' }),
  openGraph: {
    type: 'website',
    url: '/anime',
    title: '作品索引',
    description:
      '按动画作品浏览已发布的圣地巡礼路线与文章：汇总每部作品的取景地清单、机位建议与路线导航入口，适合用来快速挑选目的地并开始规划行程。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '作品索引',
    description:
      '按动画作品浏览已发布的圣地巡礼路线与文章：汇总每部作品的取景地清单、机位建议与路线导航入口，适合用来快速挑选目的地并开始规划行程。',
    images: ['/twitter-image'],
  },
}
export const revalidate = 3600
export const dynamic = 'force-static'

export default async function AnimeIndexPage() {
  const [anime, posts] = await Promise.all([getAllAnime(), getAllPublicPosts('zh')])
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
      <h1 className="text-2xl font-bold">作品</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {sorted.map((a) => (
          <AnimeCard
            key={a.id}
            anime={a}
            postCount={counts[a.id] || 0}
            cover={a.cover || coverFallback.get(a.id) || null}
            locale="zh"
          />
        ))}
      </div>
      {!sorted.length && <div className="mt-8 text-gray-500">暂无作品元数据。</div>}
    </div>
  )
}
