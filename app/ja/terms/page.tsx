import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalDocument } from '@/lib/legal/content'
import { buildJaAlternates } from '@/lib/seo/alternates'

const document = getLegalDocument('terms', 'ja')

export const metadata: Metadata = {
  title: '利用規約｜SeichiGo',
  description: 'SeichiGo の利用規約です。アカウント利用、投稿、モデレーション、責任制限などを定めています。',
  alternates: buildJaAlternates({ zhPath: '/terms' }),
  openGraph: {
    type: 'website',
    url: '/ja/terms',
    title: '利用規約｜SeichiGo',
    description: 'SeichiGo の利用規約です。アカウント利用、投稿、モデレーション、責任制限などを定めています。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '利用規約｜SeichiGo',
    description: 'SeichiGo の利用規約です。アカウント利用、投稿、モデレーション、責任制限などを定めています。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function TermsJaPage() {
  return <LegalDocument document={document} />
}
