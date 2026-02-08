import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminOpsUi from './ui'

export const metadata: Metadata = {
  title: '运维检查 - 管理后台',
  description: '每日运维巡检报告（Vercel 日志）。',
  alternates: { canonical: '/admin/ops' },
}

export default async function AdminOpsPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  return <AdminOpsUi />
}
