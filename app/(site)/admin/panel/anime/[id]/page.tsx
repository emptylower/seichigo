import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminAnimeDetailClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '作品编辑',
  description: '编辑作品元数据。',
}

export default async function AdminAnimeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  const { id } = await params
  return <AdminAnimeDetailClient id={id} />
}
