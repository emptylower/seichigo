import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getPostsByAnimeId } from '@/lib/posts/getPostsByAnimeId'
import Link from 'next/link'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function encodeAnimeIdForPath(id: string): string {
  return encodeURIComponent(id)
}

export async function generateStaticParams() {
  // Pre-render any anime JSON present
  return []
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const requestedId = safeDecodeURIComponent(String(id || '')).trim()
  const anime = await getAnimeById(requestedId)
  const canonicalId = anime?.id || requestedId || String(id || '')
  const posts = await getPostsByAnimeId(canonicalId, 'zh')
  const title = anime?.name || canonicalId
  const description = anime?.summary || `${title} · 作品聚合（${posts.length} 篇文章）`
  return {
    title,
    description,
    alternates: {
      canonical: `/anime/${encodeAnimeIdForPath(canonicalId)}`,
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/anime/${encodeAnimeIdForPath(canonicalId)}`,
    },
  }
}

export default async function AnimePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestedId = safeDecodeURIComponent(String(id || '')).trim()
  const anime = await getAnimeById(requestedId)
  const canonicalId = anime?.id || requestedId || String(id || '')
  const posts = await getPostsByAnimeId(canonicalId, 'zh')
  const display = anime ?? { id: canonicalId, name: canonicalId }
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
