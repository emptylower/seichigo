import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildJaAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

const TITLE = 'SeichiGo | アニメ聖地巡礼ガイド · AIプランナー + 世界の聖地マップ'
const DESCRIPTION =
  '作品と休みを伝えるだけで、AIプランナーがアニメ聖地巡礼の旅程を作成。毎日のルート・交通・食事に加え、世界の聖地マップと人が書いた巡礼ガイドも。'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: buildJaAlternates({ zhPath: '/' }),
  openGraph: {
    type: 'website',
    url: '/ja',
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

export default async function JapaneseHomePage() {
  const data = await getHomePortalData('ja')
  return <HomePageTemplate locale="ja" data={data} />
}
