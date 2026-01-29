import Link from 'next/link'
import Image from 'next/image'
import type { SiteLocale } from './SiteShell'
import { prefixPath } from './prefixPath'
import HeaderAuthControls from './HeaderAuthControls.client'
import { t } from '@/lib/i18n'
import LanguageSwitcher from '@/components/LanguageSwitcher'

type Props = {
  locale?: SiteLocale
}

export default function HeaderPublic({ locale = 'zh' }: Props) {
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
          <LanguageSwitcher locale={locale} />
          <HeaderAuthControls
            locale={locale}
            labels={{
              admin: t('header.admin', locale),
              favorites: t('header.favorites', locale),
              signout: t('header.signout', locale),
              signin: t('header.signin', locale),
              signup: t('header.signup', locale),
              user: t('header.user', locale),
            }}
          />
        </nav>
      </div>
    </header>
  )
}
