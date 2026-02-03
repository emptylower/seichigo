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
  const groups = await getResourceRouteGroups('zh')

  return (
    <div>
      <div className="py-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">巡礼资源</h1>
        <div className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
          按作品汇总站内文章的“总路线图”。
          <br className="hidden sm:inline" />
          每条路线与每个点位都有可引用链接，方便分享与打卡。
        </div>
      </div>

      <div className="mt-8">
        <RouteDirectory groups={groups} locale="zh" />
      </div>
    </div>
  )
}
