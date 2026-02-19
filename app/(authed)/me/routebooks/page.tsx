import { getServerAuthSession } from '@/lib/auth/session'
import RouteBooksClient from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '我的路书',
  description: '管理你的巡礼路书（需要登录）。',
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
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">我的路书</h1>
        <p className="text-gray-600">请先登录后查看路书。</p>
        <a className="btn-primary inline-flex w-fit" href={`/auth/signin?callbackUrl=${encodeURIComponent('/me/routebooks')}`}>
          去登录
        </a>
      </div>
    )
  }

  return <RouteBooksClient />
}
