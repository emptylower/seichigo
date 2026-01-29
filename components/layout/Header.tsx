import Link from 'next/link'
import Image from 'next/image'
import { getServerAuthSession } from '@/lib/auth/session'
import type { SiteLocale } from './SiteShell'
import { prefixPath } from './prefixPath'
import { t } from '@/lib/i18n'
import LanguageSwitcher from '@/components/LanguageSwitcher'

type Props = {
  locale?: SiteLocale
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

  const userLabel = String(session?.user?.name || session?.user?.email || t('header.user', locale)).trim() || t('header.user', locale)
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
          <Link href={prefixPath('/', locale)} className="hover:text-brand-600">{t('header.posts', locale)}</Link>
           <Link href={prefixPath('/anime', locale)} className="hover:text-brand-600">{t('header.anime', locale)}</Link>
           <Link href={prefixPath('/city', locale)} className="hover:text-brand-600">{t('header.city', locale)}</Link>
           <Link href={prefixPath('/resources', locale)} className="hover:text-brand-600">{t('header.resources', locale)}</Link>
           <Link href={prefixPath('/submit', locale)} className="hover:text-brand-600">{t('header.submit', locale)}</Link>
          {session?.user?.isAdmin ? <Link href={prefixPath('/admin/panel', locale)} className="hover:text-brand-600">{t('header.admin', locale)}</Link> : null}
          <LanguageSwitcher locale={locale} />
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
                  {t('header.favorites', locale)}
                </a>
                <a href="/api/auth/signout" className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  {t('header.signout', locale)}
                </a>
              </div>
            </details>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/auth/signin" className="text-gray-700 hover:text-brand-600">{t('header.signin', locale)}</Link>
              <Link href="/auth/signup" className="btn-primary">{t('header.signup', locale)}</Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}
