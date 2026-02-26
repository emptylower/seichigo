'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, ChevronRight, Clapperboard, Globe2, Home, MapPinned, PenSquare, UserRound, X } from 'lucide-react'
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

const navLabelByLocale: Record<SiteLocale, string> = {
  zh: '导航',
  en: 'Navigation',
  ja: 'ナビゲーション',
}

const navHintByLocale: Record<SiteLocale, string> = {
  zh: '快速进入主要页面',
  en: 'Quick access to core pages',
  ja: '主要ページへすばやく移動',
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

const normalizePath = (value: string) => {
  const trimmed = value.replace(/\/+$/, '')
  return trimmed || '/'
}

export default function HeaderMobileDrawer({ locale, labels }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const navItems = useMemo(
    () => [
      { href: prefixPath('/', locale), label: t('header.posts', locale), icon: Home },
      { href: prefixPath('/map', locale), label: t('header.map', locale), icon: MapPinned },
      { href: prefixPath('/anime', locale), label: t('header.anime', locale), icon: Clapperboard },
      { href: prefixPath('/city', locale), label: t('header.city', locale), icon: BookOpen },
      { href: prefixPath('/resources', locale), label: t('header.resources', locale), icon: Globe2 },
      { href: prefixPath('/submit', locale), label: t('header.submit', locale), icon: PenSquare },
    ],
    [locale]
  )

  const activePath = normalizePath(pathname || '/')

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-brand-600"
          aria-label={menuLabelByLocale[locale]}
          data-testid="header-mobile-menu-trigger"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
            <path d="M4 7h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <path d="M4 12h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <path d="M4 17h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </SheetTrigger>
      <SheetContent side="right" hideClose className="w-[88vw] max-w-sm border-l-0 bg-white p-0 shadow-[0_18px_55px_-20px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <SheetTitle className="sr-only">{menuTitleByLocale[locale]}</SheetTitle>
        <SheetDescription className="sr-only">
          {locale === 'en' ? 'Site navigation, language, and account actions' : locale === 'ja' ? 'サイトナビゲーション、言語、アカウント操作' : '站点导航、语言与账号操作'}
        </SheetDescription>

        <div className="flex h-full flex-col">
          <div className="relative border-b border-slate-200/90 px-5 py-4">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-50/70 via-white to-white" aria-hidden="true" />
            <div className="relative flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{menuTitleByLocale[locale]}</h2>
                <p className="mt-0.5 text-xs text-slate-500">{navHintByLocale[locale]}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
                aria-label={locale === 'en' ? 'Close menu' : locale === 'ja' ? 'メニューを閉じる' : '关闭菜单'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mobile-safe-bottom min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{navLabelByLocale[locale]}</h3>
                <nav className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white">
                  {navItems.map((item, index) => {
                    const Icon = item.icon
                    const active = normalizePath(item.href) === activePath

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch={false}
                        onClick={() => setOpen(false)}
                        className={`group relative flex h-12 items-center justify-between px-3 transition ${
                          index !== navItems.length - 1 ? 'border-b border-slate-100' : ''
                        } ${
                          active
                            ? 'bg-brand-50/70 text-brand-700'
                            : 'text-slate-700 hover:bg-slate-50 hover:text-brand-700'
                        }`}
                      >
                        <span className="inline-flex items-center gap-2.5">
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${
                              active ? 'bg-brand-100/80 text-brand-600' : 'bg-slate-100 text-slate-500 group-hover:bg-brand-100/70 group-hover:text-brand-600'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="text-[15px] font-medium">{item.label}</span>
                        </span>
                        <ChevronRight className={`h-4 w-4 ${active ? 'text-brand-500' : 'text-slate-300 group-hover:text-brand-400'}`} />
                      </Link>
                    )
                  })}
                </nav>
              </section>

              <section className="relative z-40">
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{languageLabelByLocale[locale]}</h3>
                <div className="rounded-2xl border border-slate-200/90 bg-white px-2 py-2">
                  <LanguageSwitcher locale={locale} />
                </div>
              </section>

              <section>
                <h3 className="mb-2 inline-flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  <UserRound className="h-3.5 w-3.5" />
                  {accountLabelByLocale[locale]}
                </h3>
                <div className="rounded-2xl border border-slate-200/90 bg-white p-2">
                  <HeaderAuthControls locale={locale} labels={labels} layout="drawer" />
                </div>
              </section>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
