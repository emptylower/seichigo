import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getStatusDocument } from '@/lib/help/content'
import { buildZhAlternates } from '@/lib/seo/alternates'

const document = getStatusDocument('zh')
const title = '系统状态｜SeichiGo'
const description = '查看 SeichiGo 各项服务的当前状态、已知问题、历史事件与计划内维护。'

export const metadata: Metadata = {
  title,
  description,
  alternates: buildZhAlternates({ path: '/status' }),
  openGraph: { type: 'website', url: '/status', title, description, images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/twitter-image'] },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function StatusPage() {
  return <LegalDocument document={document} />
}
