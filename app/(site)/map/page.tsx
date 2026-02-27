import type { Metadata } from 'next'
import { buildZhAlternates } from '@/lib/seo/alternates'
import { isMapReplicaEnabled } from '@/lib/anitabi/feature'
import { buildMapShareImageUrl, parseMapShareQuery, toUrlSearchParams } from '@/lib/anitabi/share'
import { notFound } from 'next/navigation'
import { getBootstrap } from '@/lib/anitabi/read'
import { prisma } from '@/lib/db/prisma'
import AnitabiMapPageLazy from '@/components/map/AnitabiMapPageLazy'

type SearchParamsInput = Record<string, string | string[] | undefined>

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParamsInput> }): Promise<Metadata> {
  const resolved = await searchParams
  const params = toUrlSearchParams(resolved)
  const shareQuery = parseMapShareQuery(params)
  const query = params.toString()
  const path = `/map${query ? `?${query}` : ''}`
  const shareImage = buildMapShareImageUrl('zh', shareQuery)

  return {
    title: '巡礼地图｜动画巡礼地标与截图',
    description: '按作品、城市和地标浏览巡礼地图。支持位置分享、筛选、随机跳转与地标详情查看。',
    alternates: buildZhAlternates({ path: '/map' }),
    openGraph: {
      type: 'website',
      url: path,
      title: '巡礼地图',
      description: '按作品、城市和地标浏览巡礼地图。',
      images: [shareImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: '巡礼地图',
      description: '按作品、城市和地标浏览巡礼地图。',
      images: [shareImage],
    },
  }
}

export const revalidate = 3600

export default async function MapPage() {
  if (!isMapReplicaEnabled()) {
    notFound()
  }

  let initialBootstrap
  try {
    initialBootstrap = await getBootstrap({ prisma, locale: 'zh', tab: 'latest' })
  } catch {
    initialBootstrap = undefined
  }

  return <AnitabiMapPageLazy locale="zh" initialBootstrap={initialBootstrap} />
}