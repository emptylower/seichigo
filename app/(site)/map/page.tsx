import type { Metadata } from 'next'
import { buildZhAlternates } from '@/lib/seo/alternates'
import AnitabiMapPageClient from '@/components/map/AnitabiMapPageClient'
import { isMapReplicaEnabled } from '@/lib/anitabi/feature'
import { notFound } from 'next/navigation'

export const metadata: Metadata = {
  title: '巡礼地图｜动画巡礼地标与截图',
  description: '按作品、城市和地标浏览巡礼地图。支持位置分享、筛选、随机跳转与地标详情查看。',
  alternates: buildZhAlternates({ path: '/map' }),
  openGraph: {
    type: 'website',
    url: '/map',
    title: '巡礼地图',
    description: '按作品、城市和地标浏览巡礼地图。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '巡礼地图',
    description: '按作品、城市和地标浏览巡礼地图。',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default function MapPage() {
  if (!isMapReplicaEnabled()) {
    notFound()
  }

  return <AnitabiMapPageClient locale="zh" />
}
