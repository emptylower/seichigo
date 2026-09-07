import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminBillingClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '订阅意向',
  description: '标准版订阅开关状态与开通按钮点击统计。',
  alternates: { canonical: '/admin/billing' },
}

export default async function AdminBillingPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  return <AdminBillingClient />
}
