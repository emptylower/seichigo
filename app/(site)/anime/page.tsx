import Link from 'next/link'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getAllPosts } from '@/lib/mdx/getAllPosts'

export const metadata = { title: '作品索引' }

export default async function AnimeIndexPage() {
  const [anime, posts] = await Promise.all([getAllAnime(), getAllPosts('zh')])
  const counts = posts.reduce<Record<string, number>>((acc, p) => {
    acc[p.animeId] = (acc[p.animeId] || 0) + 1
    return acc
  }, {})
  return (
    <div>
      <h1 className="text-2xl font-bold">作品</h1>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {anime.map((a) => (
          <li key={a.id} className="card">
            <Link href={`/anime/${a.id}`} className="font-semibold">{a.name}</Link>
            <p className="text-sm text-gray-600">已发布文章：{counts[a.id] || 0}</p>
          </li>
        ))}
        {!anime.length && <li className="text-gray-500">暂无作品元数据。</li>}
      </ul>
    </div>
  )
}

