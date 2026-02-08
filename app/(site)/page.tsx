import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildZhAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'SeichiGo — 动漫圣地巡礼攻略' },
  description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划，并直接提供可导航的路线点位清单。',
  alternates: buildZhAlternates({ path: '/' }),
  openGraph: {
    type: 'website',
    url: '/',
    title: 'SeichiGo — 动漫圣地巡礼攻略',
    description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划，并直接提供可导航的路线点位清单。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGo — 动漫圣地巡礼攻略',
    description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划，并直接提供可导航的路线点位清单。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 600
export const dynamic = 'force-static'

export default async function HomePage() {
  const data = await getHomePortalData('zh')
  return <HomePageTemplate locale="zh" data={data} />
}
