import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildZhAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'SeichiGo — 动漫圣地巡礼攻略' },
  description: '帮动漫爱好者规划日本圣地巡礼之旅：动漫取景地图鉴、日本动漫旅游指南、你的名字圣地巡礼、孤独摇滚巡礼路线。用好读的长文、精致排版和实用地图，完成第一次圣地巡礼的想象与规划。',
  alternates: buildZhAlternates({ path: '/' }),
  openGraph: {
    type: 'website',
    url: '/',
    title: 'SeichiGo — 动漫圣地巡礼攻略',
    description: '帮动漫爱好者规划日本圣地巡礼之旅：动漫取景地图鉴、日本动漫旅游指南、你的名字圣地巡礼、孤独摇滚巡礼路线。用好读的长文、精致排版和实用地图，完成第一次圣地巡礼的想象与规划。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGo — 动漫圣地巡礼攻略',
    description: '帮动漫爱好者规划日本圣地巡礼之旅：动漫取景地图鉴、日本动漫旅游指南、你的名字圣地巡礼、孤独摇滚巡礼路线。用好读的长文、精致排版和实用地图，完成第一次圣地巡礼的想象与规划。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 600
export const dynamic = 'force-static'

export default async function HomePage() {
  const data = await getHomePortalData('zh')
  return <HomePageTemplate locale="zh" data={data} />
}
