import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import TranslationsUI from './ui'

export const metadata = {
  title: '翻译管理 - 管理后台',
}

export default async function TranslationsPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">翻译管理</h1>
        <p className="mt-1 text-sm text-gray-600">
          搜索、审核与维护翻译任务
        </p>
      </div>
      <Suspense fallback={<AdminSkeleton rows={8} />}>
        <TranslationsUI />
      </Suspense>
    </div>
  )
}
