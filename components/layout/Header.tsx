import Link from 'next/link'
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
  return (
    <header className="border-b border-pink-100 bg-white/70 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block h-6 w-6 rounded bg-brand-500" />
          <span className="font-display text-lg">SeichiGo</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:text-brand-600">文章</Link>
          <Link href="/anime" className="hover:text-brand-600">作品</Link>
          <Link href="/about" className="hover:text-brand-600">关于</Link>
          <Link href="/submit" className="hover:text-brand-600">投稿</Link>
          {session?.user ? (
            <a href="/api/auth/signout" className="rounded-md border px-2 py-1 text-gray-600 hover:bg-gray-50">退出</a>
          ) : (
            <Link href="/auth/signin" className="btn-primary">登录</Link>
          )}
        </nav>
      </div>
    </header>
  )
}
