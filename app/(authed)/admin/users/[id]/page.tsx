import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminUserDetailClient from './ui'

export default async function AdminUserDetailPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  const { id } = await params
  
  return (
    <Suspense fallback={<div className="text-gray-600">加载中...</div>}>
      <AdminUserDetailClient id={id} />
    </Suspense>
  )
}
