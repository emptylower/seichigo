import { countPublishedArticlesByCityIds, listCitiesForIndex } from '@/lib/city/db'
import { normalizeCityAlias } from '@/lib/city/normalize'
import { prisma } from '@/lib/db/prisma'
import { getAllPosts as getAllMdxPosts } from '@/lib/mdx/getAllPosts'
import { buildJaAlternates } from '@/lib/seo/alternates'
import CityCard from '@/components/city/CityCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '都市 — 聖地巡礼ルートを探す',
  description:
    '目的地別にアニメ聖地巡礼ルートを閲覧：スポットリスト、ルート概要、マップナビゲーションリンクを含む都市ページで効率的に旅行を計画。',
  alternates: buildJaAlternates({ zhPath: '/city' }),
  openGraph: {
    type: 'website',
    url: '/ja/city',
    title: '都市',
    description:
      '目的地別にアニメ聖地巡礼ルートを閲覧：スポットリスト、ルート概要、マップナビゲーションリンクを含む都市ページで効率的に旅行を計画。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '都市',
    description:
      '目的地別にアニメ聖地巡礼ルートを閲覧：スポットリスト、ルート概要、マップナビゲーションリンクを含む都市ページで効率的に旅行を計画。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 3600
export const dynamic = 'force-static'

export default async function CityIndexJaPage() {
  const cities = await listCitiesForIndex().catch(() => [])
  const dbCounts = await countPublishedArticlesByCityIds(cities.map((c) => c.id), 'ja').catch(() => ({} as Record<string, number>))

  const aliasRows = await prisma.cityAlias.findMany({ select: { cityId: true, aliasNorm: true } }).catch(() => [])
  const aliasToCityId = new Map<string, string>()
  for (const r of aliasRows) {
    if (r?.aliasNorm && r?.cityId) aliasToCityId.set(r.aliasNorm, r.cityId)
  }
  for (const c of cities) {
    aliasToCityId.set(normalizeCityAlias(c.slug), c.id)
    aliasToCityId.set(normalizeCityAlias(c.name_zh), c.id)
    if (c.name_en) aliasToCityId.set(normalizeCityAlias(c.name_en), c.id)
    if (c.name_ja) aliasToCityId.set(normalizeCityAlias(c.name_ja), c.id)
  }

  const mdxPosts = await getAllMdxPosts('ja').catch(() => [])
  const mdxCounts: Record<string, number> = {}
  for (const p of mdxPosts) {
    const norm = normalizeCityAlias(String((p as any).city || ''))
    if (!norm) continue
    const cityId = aliasToCityId.get(norm)
    if (!cityId) continue
    mdxCounts[cityId] = (mdxCounts[cityId] || 0) + 1
  }

  const counts: Record<string, number> = {}
  for (const c of cities) {
    counts[c.id] = (dbCounts[c.id] || 0) + (mdxCounts[c.id] || 0)
  }

  const sorted = [...cities].sort((a, b) => {
    const ca = counts[a.id] || 0
    const cb = counts[b.id] || 0
    if (ca !== cb) return cb - ca
    return a.slug.localeCompare(b.slug)
  })

  return (
    <div>
      <h1 className="text-2xl font-bold">都市</h1>
      <div className="mt-2 text-sm text-gray-600">発見のための都市ハブ。コンテンツは現在ほとんど中国語です。</div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) => (
          <CityCard key={c.id} city={c} postCount={counts[c.id] || 0} locale="ja" />
        ))}
      </div>

      {!sorted.length ? <div className="mt-8 text-gray-500">都市メタデータはまだありません。</div> : null}
    </div>
  )
}
