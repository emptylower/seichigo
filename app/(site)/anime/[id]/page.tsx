import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export async function generateStaticParams() {
  // Pre-render any anime JSON present
  return []
}

export default async function AnimePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const anime = await getAnimeById(id)
  const posts = (await getAllPublicPosts('zh')).filter((p) => p.animeId === id)
  if (!anime) return <div className="text-gray-500">未找到该作品。</div>
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{anime.name}</h1>
      {anime.summary ? <p className="text-gray-700">{anime.summary}</p> : null}
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">相关文章</h2>
        <ul className="list-disc pl-6">
          {posts.map((p) => (
            <li key={p.slug}><Link href={`/posts/${p.slug}`}>{p.title}</Link></li>
          ))}
          {!posts.length && <li className="text-gray-500 list-none pl-0">暂无文章。</li>}
        </ul>
      </div>
    </div>
  )
}
