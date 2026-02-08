import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildJaAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'SeichiGo — アニメ聖地巡礼ガイド' },
  description: '読みやすい長文、美しいレイアウト、実用的なスポットリストで、アニメファンの初めての聖地巡礼の計画をサポートし、ナビゲーション可能なルートポイントリストを提供します。',
  alternates: buildJaAlternates({ zhPath: '/' }),
  openGraph: {
    type: 'website',
    url: '/ja',
    title: 'SeichiGo — アニメ聖地巡礼ガイド',
    description: '読みやすい長文、美しいレイアウト、実用的なスポットリストで、アニメファンの初めての聖地巡礼の計画をサポートし、ナビゲーション可能なルートポイントリストを提供します。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGo — アニメ聖地巡礼ガイド',
    description: '読みやすい長文、美しいレイアウト、実用的なスポットリストで、アニメファンの初めての聖地巡礼の計画をサポートし、ナビゲーション可能なルートポイントリストを提供します。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 600
export const dynamic = 'force-static'

export default async function JapaneseHomePage() {
  const data = await getHomePortalData('ja')
  return <HomePageTemplate locale="ja" data={data} />
}
