import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '管理员面板（兼容入口）',
  description: '管理员后台兼容入口，将重定向到仪表盘。',
  alternates: { canonical: '/admin/dashboard' },
}

export default async function AdminPanelPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  redirect('/admin/dashboard')
}
