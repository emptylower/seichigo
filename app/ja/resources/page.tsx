import { getResourceRouteGroups } from '@/lib/resources/aggregateRoutes'
import { buildJaAlternates } from '@/lib/seo/alternates'
import RouteDirectory from '@/components/resources/RouteDirectory'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'リソース — ルートマップ',
  description:
    '公開記事から抽出されたグループ化されたルートマップ。各ルートとスポットは参照・共有用にリンク可能です。',
  alternates: buildJaAlternates({ zhPath: '/resources' }),
  openGraph: {
    type: 'website',
    url: '/ja/resources',
    title: 'リソース',
    description:
      '公開記事から抽出されたグループ化されたルートマップ。各ルートとスポットは参照・共有用にリンク可能です。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'リソース',
    description:
      '公開記事から抽出されたグループ化されたルートマップ。各ルートとスポットは参照・共有用にリンク可能です。',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default async function ResourcesIndexJaPage() {
  const groups = await getResourceRouteGroups()

  return (
    <div>
      <h1 className="text-2xl font-bold">リソース</h1>
      <div className="mt-2 text-sm text-gray-600">公開記事から抽出されたグループ化されたルートマップ。各ルート/スポットにはリンクがあります。</div>

      <div className="mt-6">
        <RouteDirectory groups={groups} locale="ja" />
      </div>
    </div>
  )
}
