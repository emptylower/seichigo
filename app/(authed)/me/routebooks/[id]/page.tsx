import { getServerAuthSession } from '@/lib/auth/session'
import RouteBookDetailClient from './ui'
import type { Metadata } from 'next'
import MeSectionShell from '@/components/me/MeSectionShell'

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
      <MeSectionShell
        activeTab="routebooks"
        title="地图详情"
        description="编辑当前地图点位、调整顺序并导出路线。"
        wide
      >
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <p className="text-gray-600">请先登录后查看地图。</p>
          <a className="btn-primary mt-4 inline-flex w-fit no-underline" href={`/auth/signin?callbackUrl=${encodeURIComponent(`/me/routebooks/${id}`)}`}>
            去登录
          </a>
        </div>
      </MeSectionShell>
    )
  }

  return (
    <MeSectionShell
      activeTab="routebooks"
      title="地图详情"
      description="编辑当前地图点位、调整顺序并导出路线。"
      wide
    >
      <RouteBookDetailClient id={id} />
    </MeSectionShell>
  )
}
