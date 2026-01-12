import { getServerAuthSession } from '@/lib/auth/session'
import FavoritesClient from './ui'

export const metadata = { title: '我的收藏' }
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
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">我的收藏</h1>
        <p className="text-gray-600">请先登录后查看收藏。</p>
        <a className="btn-primary inline-flex w-fit" href={`/auth/signin?callbackUrl=${encodeURIComponent('/me/favorites')}`}>
          去登录
        </a>
      </div>
    )
  }

  return <FavoritesClient />
}

