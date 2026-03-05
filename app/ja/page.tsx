import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildJaAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'SeichiGo — アニメ聖地巡礼ガイド' },
  description: '日本アニメ聖地巡礼をサポート：アニメツーリズム、聖地マップ、巡礼ガイド、君の名は聖地、ぼっち・ざ・ろっく下北沢ルート。動漫聖地の一覧と実用的な旅程プランを提供。',
  alternates: buildJaAlternates({ zhPath: '/' }),
  openGraph: {
    type: 'website',
    url: '/ja',
    title: 'SeichiGo — アニメ聖地巡礼ガイド',
    description: '日本アニメ聖地巡礼をサポート：アニメツーリズム、聖地マップ、巡礼ガイド、君の名は聖地、ぼっち・ざ・ろっく下北沢ルート。動漫聖地の一覧と実用的な旅程プランを提供。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGo — アニメ聖地巡礼ガイド',
    description: '日本アニメ聖地巡礼をサポート：アニメツーリズム、聖地マップ、巡礼ガイド、君の名は聖地、ぼっち・ざ・ろっく下北沢ルート。動漫聖地の一覧と実用的な旅程プランを提供。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 600
export const dynamic = 'force-static'

export default async function JapaneseHomePage() {
  const data = await getHomePortalData('ja')
  return <HomePageTemplate locale="ja" data={data} />
}
