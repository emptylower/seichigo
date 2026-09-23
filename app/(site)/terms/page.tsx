import { pageCardImage } from '@/lib/og/pageCardUrl'
import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalDocument } from '@/lib/legal/content'
import { buildZhAlternates } from '@/lib/seo/alternates'

const document = getLegalDocument('terms', 'zh')

export const metadata: Metadata = {
  title: '用户协议｜SeichiGo',
  description: 'SeichiGo 用户协议，说明账号使用、内容发布、社区行为与责任限制等规则。',
  alternates: buildZhAlternates({ path: '/terms' }),
  openGraph: {
    type: 'website',
    url: '/terms',
    title: '用户协议｜SeichiGo',
    description: 'SeichiGo 用户协议，说明账号使用、内容发布、社区行为与责任限制等规则。',
    images: [pageCardImage('site', 'home', 'zh', 'SeichiGo 动漫圣地巡礼')],
  },
  twitter: {
    card: 'summary_large_image',
    title: '用户协议｜SeichiGo',
    description: 'SeichiGo 用户协议，说明账号使用、内容发布、社区行为与责任限制等规则。',
    images: [pageCardImage('site', 'home', 'zh', 'SeichiGo 动漫圣地巡礼')],
  },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function TermsPage() {
  return <LegalDocument document={document} />
}
