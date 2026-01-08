import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getPostsByAnimeId } from '@/lib/posts/getPostsByAnimeId'
import Link from 'next/link'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateStaticParams() {
  // Pre-render any anime JSON present
  return []
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const anime = await getAnimeById(id)
  const posts = await getPostsByAnimeId(id, 'zh')
  const title = anime?.name || id
  const description = anime?.summary || `${title} · 作品聚合（${posts.length} 篇文章）`
  return {
    title,
    description,
    alternates: {
      canonical: `/anime/${encodeURIComponent(id)}`,
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/anime/${encodeURIComponent(id)}`,
    },
  }
}

export default async function AnimePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const anime = await getAnimeById(id)
  const posts = await getPostsByAnimeId(id, 'zh')
  const display = anime ?? { id, name: id }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{display.name}</h1>
      {anime?.alias?.length ? <p className="text-sm text-gray-600">别名：{anime.alias.join(' / ')}</p> : null}
      {anime?.summary ? <p className="text-gray-700">{anime.summary}</p> : null}
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">相关文章</h2>
        <ul className="list-disc pl-6">
          {posts.map((p) => (
            <li key={p.path}><Link href={p.path}>{p.title}</Link></li>
          ))}
          {!posts.length && <li className="text-gray-500 list-none pl-0">暂无文章。</li>}
        </ul>
      </div>
    </div>
  )
}
