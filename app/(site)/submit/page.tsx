import { getServerAuthSession } from '@/lib/auth/session'
import SubmitCenterClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '创作中心',
  description: '管理草稿、投稿、更新稿与审核状态。',
  alternates: { canonical: '/submit' },
}
export const dynamic = 'force-dynamic'

export default async function SubmitCenterPage() {
  const session = await getServerAuthSession()
  const user = session?.user?.id ? { id: session.user.id, email: session.user.email } : null
  return <SubmitCenterClient user={user} />
}
