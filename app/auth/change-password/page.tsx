import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import ChangePasswordForm from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '修改密码',
  description: '修改账号密码。',
  alternates: { canonical: '/auth/change-password' },
}

export default async function ChangePasswordPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="mx-auto max-w-md px-4 py-12 text-gray-600">无权限访问。</div>
  }
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold">修改密码</h1>
      <p className="mt-2 text-sm text-gray-600">为了安全，请先修改默认密码。</p>
      <div className="mt-8">
        <ChangePasswordForm />
      </div>
    </div>
  )
}
