import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getHelpDocument } from '@/lib/help/content'
import { buildJaAlternates } from '@/lib/seo/alternates'

const document = getHelpDocument('ja')
const title = 'ヘルプセンター｜SeichiGo'
const description =
  '聖地巡礼スポットの探し方、ルート情報の読み方、投稿・修正、著作権と削除依頼の手続きをご案内します。'

export const metadata: Metadata = {
  title,
  description,
  alternates: buildJaAlternates({ zhPath: '/help' }),
  openGraph: { type: 'website', url: '/ja/help', title, description, images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/twitter-image'] },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function HelpJaPage() {
  return <LegalDocument document={document} />
}
