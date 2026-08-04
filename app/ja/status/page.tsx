import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getStatusDocument } from '@/lib/help/content'
import { buildJaAlternates } from '@/lib/seo/alternates'

const document = getStatusDocument('ja')
const title = 'システムステータス｜SeichiGo'
const description = 'SeichiGo の各サービスの稼働状況、既知の問題、障害履歴、メンテナンス予定をご確認いただけます。'

export const metadata: Metadata = {
  title,
  description,
  alternates: buildJaAlternates({ zhPath: '/status' }),
  openGraph: { type: 'website', url: '/ja/status', title, description, images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/twitter-image'] },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function StatusJaPage() {
  return <LegalDocument document={document} />
}
