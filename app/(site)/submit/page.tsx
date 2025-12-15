import { getServerAuthSession } from '@/lib/auth/session'
import SubmitCenterClient from './ui'

export const metadata = { title: '创作中心' }
export const dynamic = 'force-dynamic'

export default async function SubmitCenterPage() {
  const session = await getServerAuthSession()
  const user = session?.user?.id ? { id: session.user.id, email: session.user.email } : null
  return <SubmitCenterClient user={user} />
}
