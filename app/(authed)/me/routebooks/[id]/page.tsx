import { getServerAuthSession } from '@/lib/auth/session'
import RouteBookDetailClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '地图详情',
  description: '查看和编辑你的巡礼地图。',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function RouteBookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session: any = null
  try {
    if (process.env.DATABASE_URL) {
      session = await getServerAuthSession()
    }
  } catch {
    session = null
  }

  if (!session?.user?.id) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">地图详情</h1>
        <p className="text-gray-600">请先登录后查看地图。</p>
        <a className="btn-primary inline-flex w-fit" href={`/auth/signin?callbackUrl=${encodeURIComponent(`/me/routebooks/${id}`)}`}>
          去登录
        </a>
      </div>
    )
  }

  return <RouteBookDetailClient id={id} />
}
