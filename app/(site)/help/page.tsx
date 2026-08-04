import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getHelpDocument } from '@/lib/help/content'
import { buildZhAlternates } from '@/lib/seo/alternates'

const document = getHelpDocument('zh')
const title = '帮助中心｜SeichiGo'
const description = '圣地巡礼怎么找地点、路线信息怎么读、如何投稿纠错，以及图片版权与下架申请的处理方式。'

export const metadata: Metadata = {
  title,
  description,
  alternates: buildZhAlternates({ path: '/help' }),
  openGraph: { type: 'website', url: '/help', title, description, images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/twitter-image'] },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function HelpPage() {
  return <LegalDocument document={document} />
}
