import { getCityCountsByLocale } from '@/lib/city/getCityCountsByLocale'
import { buildJaAlternates } from '@/lib/seo/alternates'
import CityCard from '@/components/city/CityCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'アニメ聖地巡礼 都市ガイド｜目的地別に巡礼スポットを探す',
  description:
    'アニメ聖地巡礼の都市別ガイド：東京・京都などの旅行プランに役立つスポットリスト、ルート概要、マップナビゲーションリンクを含む都市ページで効率的に計画。',
  alternates: buildJaAlternates({ zhPath: '/city' }),
  openGraph: {
    type: 'website',
    url: '/ja/city',
    title: 'アニメ聖地巡礼｜都市一覧',
    description:
      'アニメ聖地巡礼の都市別ガイド：東京・京都などの旅行プランに役立つスポットリスト、ルート概要、マップナビゲーションリンクを含む都市ページで効率的に計画。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'アニメ聖地巡礼｜都市一覧',
    description:
      'アニメ聖地巡礼の都市別ガイド：東京・京都などの旅行プランに役立つスポットリスト、ルート概要、マップナビゲーションリンクを含む都市ページで効率的に計画。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 3600
export const dynamic = 'force-static'

export default async function CityIndexJaPage() {
  const { cities, counts } = await getCityCountsByLocale('ja')

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
