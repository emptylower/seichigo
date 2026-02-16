'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import type { SiteLocale } from './SiteShell'
import { prefixPath } from './prefixPath'
import { t } from '@/lib/i18n'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import HeaderAuthControls from './HeaderAuthControls.client'
import LanguageSwitcher from '@/components/LanguageSwitcher'

type Props = {
  locale: SiteLocale
  labels: {
    admin: string
    favorites: string
    signout: string
    signin: string
    signup: string
    user: string
  }
}

const menuLabelByLocale: Record<SiteLocale, string> = {
  zh: '打开菜单',
  en: 'Open menu',
  ja: 'メニューを開く',
}

const menuTitleByLocale: Record<SiteLocale, string> = {
  zh: '菜单',
  en: 'Menu',
  ja: 'メニュー',
}

const languageLabelByLocale: Record<SiteLocale, string> = {
  zh: '语言',
  en: 'Language',
  ja: '言語',
}

const accountLabelByLocale: Record<SiteLocale, string> = {
  zh: '账号',
  en: 'Account',
  ja: 'アカウント',
}

export default function HeaderMobileDrawer({ locale, labels }: Props) {
  const [open, setOpen] = useState(false)

  const navItems = [
    { href: prefixPath('/', locale), label: t('header.posts', locale) },
    { href: prefixPath('/map', locale), label: t('header.map', locale) },
    { href: prefixPath('/anime', locale), label: t('header.anime', locale) },
    { href: prefixPath('/city', locale), label: t('header.city', locale) },
    { href: prefixPath('/resources', locale), label: t('header.resources', locale) },
    { href: prefixPath('/submit', locale), label: t('header.submit', locale) },
  ]

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-brand-600"
          aria-label={menuLabelByLocale[locale]}
          data-testid="header-mobile-menu-trigger"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" hideClose className="w-[88vw] max-w-sm border-l-0 bg-white p-0 shadow-2xl">
        <SheetTitle className="sr-only">{menuTitleByLocale[locale]}</SheetTitle>
        <SheetDescription className="sr-only">
          {locale === 'en' ? 'Site navigation, language, and account actions' : locale === 'ja' ? 'サイトナビゲーション、言語、アカウント操作' : '站点导航、语言与账号操作'}
        </SheetDescription>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">{menuTitleByLocale[locale]}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              aria-label={locale === 'en' ? 'Close menu' : locale === 'ja' ? 'メニューを閉じる' : '关闭菜单'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mobile-safe-bottom min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="grid gap-5">
              <nav className="grid gap-1">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="inline-flex h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>

              <section className="space-y-2 border-t border-slate-100 pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{languageLabelByLocale[locale]}</h3>
                <div className="w-fit">
                  <LanguageSwitcher locale={locale} />
                </div>
              </section>

              <section className="space-y-2 border-t border-slate-100 pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{accountLabelByLocale[locale]}</h3>
                <HeaderAuthControls locale={locale} labels={labels} layout="stack" />
              </section>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
