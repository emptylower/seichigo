import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'

export default async function AdminEntryPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  redirect('/admin/dashboard')
}
