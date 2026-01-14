import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminReviewListClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '审核',
  description: '管理员审核投稿文章。',
  alternates: { canonical: '/admin/review' },
}

export default async function AdminReviewPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <AdminReviewListClient />
}
