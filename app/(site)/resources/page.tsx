import { getResourceRouteGroups } from '@/lib/resources/aggregateRoutes'
import { buildZhAlternates } from '@/lib/seo/alternates'
import RouteDirectory from '@/components/resources/RouteDirectory'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '巡礼资源｜作品路线地图总览',
  description:
    '按作品汇总站内文章的路线地图与点位清单，支持引用整条路线或单个点位，适合作为外链落地入口。',
  alternates: buildZhAlternates({ path: '/resources' }),
  openGraph: {
    type: 'website',
    url: '/resources',
    title: '巡礼资源',
    description:
      '按作品汇总站内文章的路线地图与点位清单，支持引用整条路线或单个点位，适合作为外链落地入口。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '巡礼资源',
    description:
      '按作品汇总站内文章的路线地图与点位清单，支持引用整条路线或单个点位，适合作为外链落地入口。',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default async function ResourcesIndexPage() {
  const groups = await getResourceRouteGroups()

  return (
    <div>
      <h1 className="text-2xl font-bold">资源</h1>
      <div className="mt-2 text-sm text-gray-600">按作品汇总站内文章的“总路线图”。每条路线与每个点位都有可引用链接。</div>

      <div className="mt-6">
        <RouteDirectory groups={groups} locale="zh" />
      </div>
    </div>
  )
}
