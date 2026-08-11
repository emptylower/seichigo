import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import AdminSettingsClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '系统设置',
  description: '系统配置信息查看。',
  alternates: { canonical: '/admin/settings' },
}

export default async function AdminSettingsPage() {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }

  const cloudflareEmailConfigured = Boolean(getCfBindings()?.env?.EMAIL)

  return (
    <AdminSettingsClient
      info={{
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '未配置',
        authUrl: process.env.NEXTAUTH_URL || '未配置',
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        emailConfigured: cloudflareEmailConfigured,
        emailProvider: cloudflareEmailConfigured ? 'Cloudflare Email Sending' : '未配置',
        version: '0.1.0',
      }}
    />
  )
}
