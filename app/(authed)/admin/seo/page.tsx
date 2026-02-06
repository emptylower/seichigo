import Link from 'next/link'
import { redirect } from 'next/navigation'
import { TrendingUp, WandSparkles } from 'lucide-react'
import { getServerAuthSession } from '@/lib/auth/session'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'SEO 管理 - 管理后台',
  description: 'SEO 管理中心：排名监控与长尾页面工厂。',
}

export default async function SeoOverviewPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">SEO 管理</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          统一管理 SEO 排名监控与长尾页面自动化生产流程。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/admin/seo/rankings"
          className="rounded-xl border bg-white p-6 shadow-sm transition-colors hover:bg-gray-50"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-brand-700">
            <TrendingUp className="h-4 w-4" />
            排名监控
          </div>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">关键词排名与 GSC</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            管理关键词、同步 GSC、执行 SERP 检查和配额监控。
          </p>
        </Link>

        <Link
          href="/admin/seo/spoke-factory"
          className="rounded-xl border bg-white p-6 shadow-sm transition-colors hover:bg-gray-50"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-brand-700">
            <WandSparkles className="h-4 w-4" />
            长尾页面工厂
          </div>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">SEO Spoke 自动化</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            手动触发候选提取、AI 生成三语页面并自动创建 PR。
          </p>
        </Link>
      </div>
    </div>
  )
}

