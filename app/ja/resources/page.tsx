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
      <div className="py-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">リソース</h1>
        <div className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
          公開記事から抽出されたグループ化されたルートマップ。
          <br className="hidden sm:inline" />
          各ルートとスポットは参照・共有用にリンク可能です。
        </div>
      </div>

      <div className="mt-8">
        <RouteDirectory groups={groups} locale="ja" />
      </div>
    </div>
  )
}
