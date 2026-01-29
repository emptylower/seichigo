import Link from 'next/link'
import type { Metadata } from 'next'
import { buildJaAlternates } from '@/lib/seo/alternates'

export const metadata: Metadata = {
  title: { absolute: 'SeichiGo — アニメ聖地巡礼ガイド' },
  description: '実用的なスポットリスト、ルートマップ、撮影のコツを含む、詳細なアニメ聖地巡礼ガイド。',
  alternates: buildJaAlternates({ zhPath: '/' }),
  openGraph: {
    type: 'website',
    url: '/ja',
    title: 'SeichiGo — アニメ聖地巡礼ガイド',
    description: '実用的なスポットリスト、ルートマップ、撮影のコツを含む、詳細なアニメ聖地巡礼ガイド。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGo — アニメ聖地巡礼ガイド',
    description: '実用的なスポットリスト、ルートマップ、撮影のコツを含む、詳細なアニメ聖地巡礼ガイド。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 3600
export const dynamic = 'force-static'

export default function JapaneseHomePage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-5xl">アニメ聖地巡礼ガイド</h1>
        <p className="max-w-2xl text-sm text-gray-600 md:text-base">
          実用的なルート、スポットチェックリスト、マップエントリーポイント。日本語ページは順次公開中です。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/ja/anime" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">アニメで探す</div>
          <div className="mt-1 text-sm text-gray-700">作品ハブページと関連ルート。</div>
        </Link>
        <Link href="/ja/city" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">都市で探す</div>
          <div className="mt-1 text-sm text-gray-700">都市ハブでロングテール発見。</div>
        </Link>
        <Link href="/ja/resources" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">リソース</div>
          <div className="mt-1 text-sm text-gray-700">マップ、チェックリスト、マナーページ。</div>
        </Link>
        <Link href="/" className="card no-underline hover:no-underline">
          <div className="text-sm font-semibold text-gray-900">中国語に切り替え</div>
          <div className="mt-1 text-sm text-gray-700">中国語で全カタログを読む。</div>
        </Link>
      </div>
    </div>
  )
}
