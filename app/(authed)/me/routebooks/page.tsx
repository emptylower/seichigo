import { getServerAuthSession } from '@/lib/auth/session'
import RouteBooksClient from './ui'
import type { Metadata } from 'next'
import MeSectionShell from '@/components/me/MeSectionShell'

export const metadata: Metadata = {
  title: '我的地图',
  description: '管理你的巡礼地图（需要登录）。',
  alternates: { canonical: '/me/routebooks' },
}
export const dynamic = 'force-dynamic'

export default async function RouteBooksPage() {
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
        title="我的地图"
        description="创建并管理你的巡礼路线地图，把想去点位整理成可执行计划。"
      >
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <p className="text-gray-600">请先登录后查看地图。</p>
          <a className="btn-primary mt-4 inline-flex w-fit no-underline" href={`/auth/signin?callbackUrl=${encodeURIComponent('/me/routebooks')}`}>
            去登录
          </a>
        </div>
      </MeSectionShell>
    )
  }

  return (
    <MeSectionShell
      activeTab="routebooks"
      title="我的地图"
      description="创建并管理你的巡礼路线地图，把想去点位整理成可执行计划。"
    >
      <RouteBooksClient />
    </MeSectionShell>
  )
}
