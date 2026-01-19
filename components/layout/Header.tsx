import Link from 'next/link'
import Image from 'next/image'
import { getServerAuthSession } from '@/lib/auth/session'

export default async function Header() {
  let session: any = null
  try {
    if (process.env.DATABASE_URL) {
      session = await getServerAuthSession()
    }
  } catch (e) {
    console.warn('Auth unavailable (is DATABASE_URL configured?)')
  }
  const userLabel = String(session?.user?.name || session?.user?.email || '用户').trim() || '用户'
  const avatarLetter = userLabel.slice(0, 1).toUpperCase()
  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/brand/app-logo.png"
            alt="SeichiGo"
            width={32}
            height={32}
            className="h-8 w-8 rounded-md bg-white object-cover"
            priority
          />
          <span className="font-display text-lg">SeichiGo</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:text-brand-600">文章</Link>
          <Link href="/anime" className="hover:text-brand-600">作品</Link>
          <Link href="/about" className="hover:text-brand-600">关于</Link>
          <Link href="/submit" className="hover:text-brand-600">投稿</Link>
          {session?.user?.isAdmin ? <Link href="/admin/panel" className="hover:text-brand-600">管理员面板</Link> : null}
          {session?.user ? (
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border px-2 py-1 text-gray-700 hover:bg-gray-50">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pink-100 text-xs font-semibold text-pink-700">
                  {avatarLetter}
                </span>
                <span className="max-w-28 truncate">{userLabel}</span>
              </summary>
              <div className="absolute right-0 mt-2 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                <a href="/me/favorites" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  我的收藏
                </a>
                <a href="/api/auth/signout" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  退出
                </a>
              </div>
            </details>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/auth/signin" className="text-gray-700 hover:text-brand-600">登录</Link>
              <Link href="/auth/signup" className="btn-primary">注册</Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}
