import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminSettingsClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '系统设置',
  description: '系统配置信息查看。',
  alternates: { canonical: '/admin/settings' },
}

export default async function AdminSettingsPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <AdminSettingsClient />
}
