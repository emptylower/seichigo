import Link from 'next/link'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '作品索引',
  description: '按作品浏览已发布的圣地巡礼路线与文章，快速找到对应动画的点位清单、机位建议与地图导航入口。',
  alternates: { canonical: '/anime' },
  openGraph: {
    type: 'website',
    url: '/anime',
    title: '作品索引',
    description: '按作品浏览已发布的圣地巡礼路线与文章，快速找到对应动画的点位清单、机位建议与地图导航入口。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '作品索引',
    description: '按作品浏览已发布的圣地巡礼路线与文章，快速找到对应动画的点位清单、机位建议与地图导航入口。',
    images: ['/twitter-image'],
  },
}
export const dynamic = 'force-dynamic'

export default async function AnimeIndexPage() {
  const [anime, posts] = await Promise.all([getAllAnime(), getAllPublicPosts('zh')])
  const counts = posts.reduce<Record<string, number>>((acc, p) => {
    for (const id of p.animeIds || []) {
      acc[id] = (acc[id] || 0) + 1
    }
    return acc
  }, {})
  return (
    <div>
      <h1 className="text-2xl font-bold">作品</h1>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {anime.map((a) => (
          <li key={a.id} className="card">
            <Link href={`/anime/${encodeURIComponent(a.id)}`} className="font-semibold">{a.name}</Link>
            <p className="text-sm text-gray-600">已发布文章：{counts[a.id] || 0}</p>
          </li>
        ))}
        {!anime.length && <li className="text-gray-500">暂无作品元数据。</li>}
      </ul>
    </div>
  )
}
