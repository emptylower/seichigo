import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminPanelArticleClient from './ui'
import type { Metadata } from 'next'

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function encodeIdForPath(id: string): string {
  return encodeURIComponent(id)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const decoded = safeDecodeURIComponent(String(id || '')).trim()
  const canonicalId = decoded || String(id || '')
  return {
    title: '文章管理',
    description: '管理文章状态与元数据。',
    alternates: { canonical: `/admin/panel/articles/${encodeIdForPath(canonicalId)}` },
  }
}

export default async function AdminPanelArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  const { id } = await params
  return <AdminPanelArticleClient id={id} />
}
