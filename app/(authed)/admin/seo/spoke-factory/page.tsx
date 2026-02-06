import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import SpokeFactoryUi from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '长尾页面工厂 - 管理后台',
  description: '自动生成 SEO spoke 页面并创建 PR。',
}

export default async function SeoSpokeFactoryPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  const generateEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.SEO_AUTOMATION_ENABLE_GENERATE || '').toLowerCase()
  )

  return (
    <SpokeFactoryUi
      generateEnabled={generateEnabled}
      defaults={{
        mode: 'preview',
        locales: ['zh', 'en', 'ja'],
        scope: 'all',
        maxTopics: 30,
      }}
    />
  )
}

