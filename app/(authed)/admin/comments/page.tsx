import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getServerAuthSession } from '@/lib/auth/session'
import CommentsAdminUI from './ui'

export const metadata: Metadata = {
  title: '评论治理 - 管理后台',
  description: '查看举报评论并执行隐藏、恢复或删除操作。',
}

export default async function AdminCommentsPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <CommentsAdminUI />
}
