import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminAnimeListClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '作品管理',
  description: '管理作品元数据。',
  alternates: { canonical: '/admin/panel/anime' },
}

export default async function AdminAnimeListPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <AdminAnimeListClient />
}
