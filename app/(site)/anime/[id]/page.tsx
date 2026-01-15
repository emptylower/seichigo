import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getPostsByAnimeId } from '@/lib/posts/getPostsByAnimeId'
import { buildBreadcrumbListJsonLd } from '@/lib/seo/jsonld'
import { getSiteOrigin } from '@/lib/seo/site'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

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
  const anime = await getAnimeById(requestedId).catch(() => null)
  const canonicalId = anime?.id || requestedId || String(id || '')
  const posts = await getPostsByAnimeId(canonicalId, 'zh')
  if (!anime && posts.length === 0) {
    return { title: '未找到作品', robots: { index: false, follow: false } }
  }
  const title = anime?.name || canonicalId
  const summary = String(anime?.summary || '').trim()
  const fallback = `${title} 圣地巡礼作品聚合页，汇总相关路线与文章（${posts.length} 篇），提供地图导航与点位清单。`
  const description = summary ? `${summary} ${fallback}` : fallback
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
      images: ['/opengraph-image'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/twitter-image'],
    },
  }
}

export default async function AnimePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestedId = safeDecodeURIComponent(String(id || '')).trim()
  const anime = await getAnimeById(requestedId).catch(() => null)
  const canonicalId = anime?.id || requestedId || String(id || '')
  if (requestedId && canonicalId && requestedId !== canonicalId) {
    permanentRedirect(`/anime/${encodeAnimeIdForPath(canonicalId)}`)
  }
  const posts = await getPostsByAnimeId(canonicalId, 'zh')
  if (!anime && posts.length === 0) {
    return notFound()
  }
  const display = anime ?? { id: canonicalId, name: canonicalId }
  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/anime/${encodeAnimeIdForPath(canonicalId)}`
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: '首页', url: `${siteOrigin}/` },
    { name: '作品', url: `${siteOrigin}/anime` },
    { name: display.name, url: canonicalUrl },
  ])
  return (
    <>
      {breadcrumbJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      ) : null}
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { name: '首页', href: '/' },
            { name: '作品', href: '/anime' },
            { name: display.name, href: `/anime/${encodeAnimeIdForPath(canonicalId)}` },
          ]}
        />
        <h1 className="text-2xl font-bold">{display.name}</h1>
        {anime?.alias?.length ? <p className="text-sm text-gray-600">别名：{anime.alias.join(' / ')}</p> : null}
        {anime?.summary ? <p className="text-gray-700">{anime.summary}</p> : null}
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">相关文章</h2>
          <ul className="list-disc pl-6">
            {posts.map((p) => (
              <li key={p.path}>
                <Link href={p.path}>{p.title}</Link>
              </li>
            ))}
            {!posts.length && <li className="text-gray-500 list-none pl-0">暂无文章。</li>}
          </ul>
        </div>
      </div>
    </>
  )
}
