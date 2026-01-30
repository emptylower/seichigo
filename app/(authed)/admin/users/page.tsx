import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import UsersListClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '用户管理',
  description: '管理系统用户。',
}

export default async function UsersListPage() {
  const session = await getServerAuthSession()
  
  if (!session?.user) {
    redirect('/auth/signin')
  }
  
  if (!session.user.isAdmin) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4">
        <h1 className="text-2xl font-bold text-red-600">无权限访问</h1>
        <p className="text-gray-500">该页面仅限管理员访问。</p>
      </div>
    )
  }

  return <UsersListClient />
}
