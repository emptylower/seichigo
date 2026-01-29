import { getServerAuthSession } from '@/lib/auth/session'
import SubmitCenterClient from '../../(authed)/submit/ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '投稿センター',
  description: '下書き、投稿、更新、審査状況を管理。',
  alternates: { canonical: '/ja/submit' },
}
export const dynamic = 'force-dynamic'

export default async function SubmitCenterJaPage() {
  const session = await getServerAuthSession()
  const user = session?.user?.id ? { id: session.user.id, email: session.user.email } : null
  return <SubmitCenterClient user={user} />
}
