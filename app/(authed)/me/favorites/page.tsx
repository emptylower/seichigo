import { getServerAuthSession } from '@/lib/auth/session'
import FavoritesClient from './ui'
import type { Metadata } from 'next'
import MeSectionShell from '@/components/me/MeSectionShell'

export const metadata: Metadata = {
  title: '我的收藏',
  description: '查看你收藏的路线与文章（需要登录）。',
  alternates: { canonical: '/me/favorites' },
}
export const dynamic = 'force-dynamic'

export default async function FavoritesPage() {
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
        activeTab="favorites"
        title="我的收藏"
        description="集中管理你收藏过的文章，方便继续阅读与路线规划。"
      >
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <p className="text-gray-600">请先登录后查看收藏。</p>
          <a className="btn-primary mt-4 inline-flex w-fit no-underline" href={`/auth/signin?callbackUrl=${encodeURIComponent('/me/favorites')}`}>
            去登录
          </a>
        </div>
      </MeSectionShell>
    )
  }

  return (
    <MeSectionShell
      activeTab="favorites"
      title="我的收藏"
      description="集中管理你收藏过的文章，方便继续阅读与路线规划。"
    >
      <FavoritesClient />
    </MeSectionShell>
  )
}
