import Link from 'next/link'
import Image from 'next/image'
import type { SiteLocale } from './SiteShell'
import { prefixPath } from './prefixPath'
import HeaderAuthControls from './HeaderAuthControls.client'
import { t } from '@/lib/i18n'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import HeaderMobileDrawer from './HeaderMobileDrawer.client'

type Props = {
  locale?: SiteLocale
}

export default function HeaderPublic({ locale = 'zh' }: Props) {
  const labels = {
    admin: t('header.admin', locale),
    favorites: t('header.favorites', locale),
    signout: t('header.signout', locale),
    signin: t('header.signin', locale),
    signup: t('header.signup', locale),
    user: t('header.user', locale),
  }

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex min-h-[var(--site-header-h)] max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:gap-4">
        <Link href={prefixPath('/', locale)} className="shrink-0 flex min-h-11 items-center gap-2">
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

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-4 md:flex">
          <nav className="flex min-w-0 items-center justify-end gap-4 overflow-x-auto whitespace-nowrap text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link href={prefixPath('/', locale)} className="inline-flex min-h-11 items-center hover:text-brand-600">{t('header.posts', locale)}</Link>
            <Link href={prefixPath('/anime', locale)} className="inline-flex min-h-11 items-center hover:text-brand-600">{t('header.anime', locale)}</Link>
            <Link href={prefixPath('/map', locale)} className="inline-flex min-h-11 items-center hover:text-brand-600">{t('header.map', locale)}</Link>
            <Link href={prefixPath('/city', locale)} className="inline-flex min-h-11 items-center hover:text-brand-600">{t('header.city', locale)}</Link>
            <Link href={prefixPath('/resources', locale)} className="inline-flex min-h-11 items-center hover:text-brand-600">{t('header.resources', locale)}</Link>
            <Link href={prefixPath('/submit', locale)} className="inline-flex min-h-11 items-center hover:text-brand-600">{t('header.submit', locale)}</Link>
          </nav>
          <div className="flex shrink-0 items-center gap-3 text-sm sm:gap-4">
            <LanguageSwitcher locale={locale} />
            <HeaderAuthControls locale={locale} labels={labels} />
          </div>
        </div>

        <div className="md:hidden">
          <HeaderMobileDrawer locale={locale} labels={labels} />
        </div>
      </div>
    </header>
  )
}
