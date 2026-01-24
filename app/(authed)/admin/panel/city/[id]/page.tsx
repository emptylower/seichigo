import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminCityDetailClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '城市编辑',
  description: '编辑城市元数据。',
}

export default async function AdminCityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  const { id } = await params
  return <AdminCityDetailClient id={id} />
}
