import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import MaintenanceClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '维护工具',
  description: '管理员维护工具（数据修复/回填）。',
  alternates: { canonical: '/admin/maintenance' },
}

export default async function AdminMaintenancePage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <MaintenanceClient />
}
