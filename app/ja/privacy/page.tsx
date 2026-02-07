import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalDocument } from '@/lib/legal/content'
import { buildJaAlternates } from '@/lib/seo/alternates'

const document = getLegalDocument('privacy', 'ja')

export const metadata: Metadata = {
  title: 'プライバシーポリシー｜SeichiGo',
  description: 'SeichiGo における認証、投稿、コメント、お気に入り、分析時の個人情報の取り扱いを説明します。',
  alternates: buildJaAlternates({ zhPath: '/privacy' }),
  openGraph: {
    type: 'website',
    url: '/ja/privacy',
    title: 'プライバシーポリシー｜SeichiGo',
    description: 'SeichiGo における認証、投稿、コメント、お気に入り、分析時の個人情報の取り扱いを説明します。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'プライバシーポリシー｜SeichiGo',
    description: 'SeichiGo における認証、投稿、コメント、お気に入り、分析時の個人情報の取り扱いを説明します。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function PrivacyJaPage() {
  return <LegalDocument document={document} />
}
