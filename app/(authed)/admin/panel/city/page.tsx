import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminCityListClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '城市管理',
  description: '管理城市元数据与别名。',
  alternates: { canonical: '/admin/panel/city' },
}

export default async function AdminCityListPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <AdminCityListClient />
}
