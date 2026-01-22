import Link from 'next/link'
import Image from 'next/image'
import { getServerAuthSession } from '@/lib/auth/session'
import type { SiteLocale } from './SiteShell'

type Props = {
  locale?: SiteLocale
}

function prefixPath(path: string, locale: SiteLocale): string {
  const clean = path.startsWith('/en') ? path.slice(3) || '/' : path
  if (locale === 'en') {
    if (clean === '/') return '/en'
    return `/en${clean}`
  }
  return clean
}

export default async function Header({ locale = 'zh' }: Props) {
  let session: any = null
  try {
    if (process.env.DATABASE_URL) {
      session = await getServerAuthSession()
    }
  } catch (e) {
    console.warn('Auth unavailable (is DATABASE_URL configured?)')
  }

  const labels =
    locale === 'en'
      ? {
          posts: 'Posts',
          anime: 'Anime',
           city: 'Cities',
           resources: 'Resources',
           submit: 'Submit',
           admin: 'Admin',
           favorites: 'Favorites',
          signout: 'Sign out',
          signin: 'Sign in',
          signup: 'Sign up',
          user: 'User',
        }
      : {
          posts: '文章',
           anime: '作品',
           city: '城市',
           resources: '资源',
           submit: '投稿',
           admin: '管理员面板',
           favorites: '我的收藏',
          signout: '退出',
          signin: '登录',
          signup: '注册',
          user: '用户',
        }

  const userLabel = String(session?.user?.name || session?.user?.email || labels.user).trim() || labels.user
  const avatarLetter = userLabel.slice(0, 1).toUpperCase()

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href={prefixPath('/', locale)} className="flex items-center gap-2">
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
          <Link href={prefixPath('/', locale)} className="hover:text-brand-600">{labels.posts}</Link>
           <Link href={prefixPath('/anime', locale)} className="hover:text-brand-600">{labels.anime}</Link>
           <Link href={prefixPath('/city', locale)} className="hover:text-brand-600">{labels.city}</Link>
           <Link href={prefixPath('/resources', locale)} className="hover:text-brand-600">{labels.resources}</Link>
           <Link href={prefixPath('/submit', locale)} className="hover:text-brand-600">{labels.submit}</Link>
          {session?.user?.isAdmin ? <Link href={prefixPath('/admin/panel', locale)} className="hover:text-brand-600">{labels.admin}</Link> : null}
          {session?.user ? (
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border px-2 py-1 text-gray-700 hover:bg-gray-50">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pink-100 text-xs font-semibold text-pink-700">
                  {avatarLetter}
                </span>
                <span className="max-w-28 truncate">{userLabel}</span>
              </summary>
              <div className="absolute right-0 mt-2 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                <a href={prefixPath('/me/favorites', locale)} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  {labels.favorites}
                </a>
                <a href="/api/auth/signout" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  {labels.signout}
                </a>
              </div>
            </details>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/auth/signin" className="text-gray-700 hover:text-brand-600">{labels.signin}</Link>
              <Link href="/auth/signup" className="btn-primary">{labels.signup}</Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}
