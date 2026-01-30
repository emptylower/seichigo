import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminWaitlistClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Waitlist',
  description: '查看 App Waitlist 队列。',
  alternates: { canonical: '/admin/waitlist' },
}

export default async function AdminWaitlistPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  return <AdminWaitlistClient />
}
