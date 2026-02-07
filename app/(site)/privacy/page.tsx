import type { Metadata } from 'next'
import LegalDocument from '@/components/legal/LegalDocument'
import { getLegalDocument } from '@/lib/legal/content'
import { buildZhAlternates } from '@/lib/seo/alternates'

const document = getLegalDocument('privacy', 'zh')

export const metadata: Metadata = {
  title: '隐私政策｜SeichiGo',
  description: '了解 SeichiGo 如何在登录、投稿、评论、收藏与分析功能中处理你的个人信息。',
  alternates: buildZhAlternates({ path: '/privacy' }),
  openGraph: {
    type: 'website',
    url: '/privacy',
    title: '隐私政策｜SeichiGo',
    description: '了解 SeichiGo 如何在登录、投稿、评论、收藏与分析功能中处理你的个人信息。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '隐私政策｜SeichiGo',
    description: '了解 SeichiGo 如何在登录、投稿、评论、收藏与分析功能中处理你的个人信息。',
    images: ['/twitter-image'],
  },
}

export const revalidate = 86400
export const dynamic = 'force-static'

export default function PrivacyPage() {
  return <LegalDocument document={document} />
}
