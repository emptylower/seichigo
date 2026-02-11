import type { Metadata } from 'next'
import { buildJaAlternates } from '@/lib/seo/alternates'
import AnitabiMapPageClient from '@/components/map/AnitabiMapPageClient'
import { isMapReplicaEnabled } from '@/lib/anitabi/feature'
import { notFound } from 'next/navigation'

export const metadata: Metadata = {
  title: '巡礼マップ',
  description: '作品・都市・スポットで巡礼ポイントを検索し、状態を共有できる地図。',
  alternates: buildJaAlternates({ zhPath: '/map' }),
  openGraph: {
    type: 'website',
    url: '/ja/map',
    title: '巡礼マップ',
    description: '作品・都市・スポットで巡礼ポイントを検索し、状態を共有できる地図。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '巡礼マップ',
    description: '作品・都市・スポットで巡礼ポイントを検索し、状態を共有できる地図。',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default function MapPageJa() {
  if (!isMapReplicaEnabled()) {
    notFound()
  }

  return <AnitabiMapPageClient locale="ja" />
}
