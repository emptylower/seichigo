import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth/session'
import AdminReviewDetailClient from './ui'
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
    title: '审核详情',
    description: '查看投稿详情并进行审核处理。',
    alternates: { canonical: `/admin/review/${encodeIdForPath(canonicalId)}` },
  }
}

export default async function AdminReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user) redirect('/auth/signin')
  if (!session.user.isAdmin) {
    return <div className="text-gray-600">无权限访问。</div>
  }
  const { id } = await params
  return <AdminReviewDetailClient id={id} />
}
