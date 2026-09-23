import Link from 'next/link'
import { CalendarRange, Heart, Map, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

type MeTabKey = 'plan' | 'settings' | 'favorites' | 'routebooks'

type Props = {
  activeTab: MeTabKey
  title: string
  description: string
  children: React.ReactNode
  wide?: boolean
  locale?: SupportedLocale
}

const tabs: Array<{ key: MeTabKey; href: string; icon: LucideIcon }> = [
  { key: 'plan', href: '/plan', icon: CalendarRange },
  { key: 'settings', href: '/me/settings', icon: User },
  { key: 'favorites', href: '/me/favorites', icon: Heart },
  { key: 'routebooks', href: '/me/routebooks', icon: Map },
]

export default function MeSectionShell({ activeTab, title, description, children, wide = false, locale = 'zh' }: Props) {
  return (
    <section data-layout-wide="true" className={`mx-auto w-full ${wide ? 'max-w-7xl' : 'max-w-6xl'} overflow-x-hidden px-4 sm:px-6 lg:px-8`}>
      <div className="grid gap-5 lg:grid-cols-[252px_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <div className="rounded-3xl border border-slate-200/90 bg-[radial-gradient(120%_120%_at_0%_0%,#fff1f7_0%,#ffffff_45%,#ffffff_100%)] p-3.5 shadow-[0_22px_40px_-32px_rgba(15,23,42,0.62)]">
            <div className="px-2 pb-2">
              <p className="text-xs font-semibold tracking-[0.12em] text-slate-500">{t('me.tabs.sectionTitle', locale)}</p>
              <p className="mt-1 text-xs text-slate-400">{t('me.tabs.sectionHint', locale)}</p>
            </div>
            <nav
              aria-label={t('me.tabs.sectionTitle', locale)}
              className="flex flex-col gap-2.5 lg:flex-col lg:gap-2.5"
            >
              {tabs.map((tab) => {
                const active = tab.key === activeTab
                const Icon = tab.icon
                return (
                  <Link
                    key={tab.key}
                    href={tab.href}
                    prefetch={false}
                    className={`group inline-flex min-h-[56px] w-full shrink-0 flex-row items-center gap-3 rounded-2xl border px-3 py-2.5 text-left no-underline transition-all duration-200 sm:min-h-[64px] lg:w-full ${
                      active
                        ? 'border-pink-200 bg-white text-slate-900 shadow-[0_12px_24px_-20px_rgba(236,72,153,0.8)]'
                        : 'border-transparent bg-white/70 text-slate-600 hover:border-pink-100 hover:bg-white hover:text-slate-900'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                        active
                          ? 'border-pink-200 bg-brand-500 text-white'
                          : 'border-slate-200 bg-white text-slate-500 group-hover:border-pink-200 group-hover:text-pink-700'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-none">{t(`me.tabs.${tab.key}.label`, locale)}</span>
                      <span className={`mt-1 block text-xs ${active ? 'text-slate-500' : 'text-slate-400 group-hover:text-slate-500'}`}>
                        {t(`me.tabs.${tab.key}.hint`, locale)}
                      </span>
                    </span>
                  </Link>
                )
              })}
            </nav>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <header className="px-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[30px]">{title}</h1>
            <p className="mt-1 text-sm text-slate-600 sm:text-[15px]">{description}</p>
          </header>
          {children}
        </div>
      </div>
    </section>
  )
}
