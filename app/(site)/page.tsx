import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildZhAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

const TITLE = '动漫圣地巡礼行程规划 · AI 规划师 + 全球巡礼点位地图 | SeichiGo'
const DESCRIPTION =
  '说出看过的作品和假期，AI 规划师帮你做动漫圣地巡礼的行程规划：每天的路线、交通与餐厅一次排好，配全球巡礼地图与人写的巡礼攻略。'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: buildZhAlternates({ path: '/' }),
  openGraph: {
    type: 'website',
    url: '/',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/twitter-image'],
  },
}

// 2026-09-08 首页数据变化慢，缩短再生成频率以减少过期瞬间的访客等待
export const revalidate = 1800
export const dynamic = 'force-static'

export default async function HomePage() {
  const data = await getHomePortalData('zh')
  return <HomePageTemplate locale="zh" data={data} />
}
