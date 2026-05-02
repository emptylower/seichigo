import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminMapImageDiagnosticsUi from './ui'

export const metadata: Metadata = {
  title: '地图图片诊断 - 管理后台',
  description: '查看地图图片链路诊断会话与时间线。',
  alternates: { canonical: '/admin/ops/map-image-diagnostics' },
}

export default async function AdminMapImageDiagnosticsPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  return <AdminMapImageDiagnosticsUi />
}
