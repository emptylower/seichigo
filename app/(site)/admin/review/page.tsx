import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminReviewListClient from './ui'

export const metadata = { title: '审核' }

export default async function AdminReviewPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <AdminReviewListClient />
}

