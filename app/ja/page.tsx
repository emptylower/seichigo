import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildJaAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

const TITLE = 'アニメ聖地巡礼の旅程プランニング · AIプランナー + 世界の聖地マップ | SeichiGo'
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

export const revalidate = 120
export const dynamic = 'force-static'

export default async function JapaneseHomePage() {
  const data = await getHomePortalData('ja')
  return <HomePageTemplate locale="ja" data={data} />
}
