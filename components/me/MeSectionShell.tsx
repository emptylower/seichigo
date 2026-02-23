import Link from 'next/link'

type MeTabKey = 'settings' | 'favorites' | 'routebooks'

type Props = {
  activeTab: MeTabKey
  title: string
  description: string
  children: React.ReactNode
  wide?: boolean
}

const tabs: Array<{ key: MeTabKey; label: string; href: string }> = [
  { key: 'settings', label: '个人信息', href: '/me/settings' },
  { key: 'favorites', label: '我的收藏', href: '/me/favorites' },
  { key: 'routebooks', label: '我的地图', href: '/me/routebooks' },
]

export default function MeSectionShell({ activeTab, title, description, children, wide = false }: Props) {
  return (
    <section className={`mx-auto w-full ${wide ? 'max-w-7xl' : 'max-w-6xl'} px-4 sm:px-6`}>
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-pink-100/80 bg-white/90 p-3 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.45)]">
            <p className="px-2 pb-2 text-xs font-semibold tracking-[0.08em] text-slate-500">用户中心</p>
            <nav aria-label="用户中心导航" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {tabs.map((tab) => {
                const active = tab.key === activeTab
                return (
                  <Link
                    key={tab.key}
                    href={tab.href}
                    prefetch={false}
                    className={`inline-flex min-h-10 shrink-0 items-center rounded-xl border px-3.5 text-sm font-medium no-underline transition lg:w-full ${
                      active
                        ? 'border-pink-200 bg-brand-500 text-white shadow-[0_12px_20px_-16px_rgba(236,72,153,0.8)]'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-pink-200 hover:text-pink-700'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    {tab.label}
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
