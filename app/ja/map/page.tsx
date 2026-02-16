import type { Metadata } from 'next'
import { buildJaAlternates } from '@/lib/seo/alternates'
import { isMapReplicaEnabled } from '@/lib/anitabi/feature'
import { buildMapShareImageUrl, parseMapShareQuery, toUrlSearchParams } from '@/lib/anitabi/share'
import { notFound } from 'next/navigation'
import AnitabiMapPageLazy from '@/components/map/AnitabiMapPageLazy'

type SearchParamsInput = Record<string, string | string[] | undefined>

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParamsInput> }): Promise<Metadata> {
  const resolved = await searchParams
  const params = toUrlSearchParams(resolved)
  const shareQuery = parseMapShareQuery(params)
  const query = params.toString()
  const path = `/ja/map${query ? `?${query}` : ''}`
  const shareImage = buildMapShareImageUrl('ja', shareQuery)

  return {
    title: '巡礼マップ',
    description: '作品・都市・スポットで巡礼ポイントを検索し、状態を共有できる地図。',
    alternates: buildJaAlternates({ zhPath: '/map' }),
    openGraph: {
      type: 'website',
      url: path,
      title: '巡礼マップ',
      description: '作品・都市・スポットで巡礼ポイントを検索し、状態を共有できる地図。',
      images: [shareImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: '巡礼マップ',
      description: '作品・都市・スポットで巡礼ポイントを検索し、状態を共有できる地図。',
      images: [shareImage],
    },
  }
}

export const revalidate = 3600

export default function MapPageJa() {
  if (!isMapReplicaEnabled()) {
    notFound()
  }

  return <AnitabiMapPageLazy locale="ja" />
}
