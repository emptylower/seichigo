import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminPanelClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '管理员面板',
  description: '管理员后台：内容与数据管理。',
  alternates: { canonical: '/admin/panel' },
}

export default async function AdminPanelPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <AdminPanelClient />
}
