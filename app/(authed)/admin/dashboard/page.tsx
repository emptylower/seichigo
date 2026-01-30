import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminDashboardClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '仪表盘 - 管理后台',
  description: 'SeichiGo 管理后台仪表盘。',
}

export default async function AdminDashboardPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <AdminDashboardClient />
}
