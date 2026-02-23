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
    <section className={`mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-5xl'} space-y-6`}>
      <div className="overflow-hidden rounded-3xl border border-pink-100/80 bg-gradient-to-br from-white via-rose-50/70 to-pink-50/70 shadow-[0_14px_38px_-24px_rgba(236,72,153,0.45)]">
        <div className="space-y-4 px-5 py-6 sm:px-7">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-pink-500/80">Personal Space</p>
            <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{title}</h1>
            <p className="max-w-2xl text-sm text-slate-600 sm:text-[15px]">{description}</p>
          </div>
          <nav aria-label="用户中心导航" className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const active = tab.key === activeTab
              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  prefetch={false}
                  className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium no-underline transition ${
                    active
                      ? 'border-pink-200 bg-pink-500 text-white shadow-[0_10px_24px_-16px_rgba(236,72,153,0.8)]'
                      : 'border-pink-100 bg-white/85 text-slate-700 hover:border-pink-200 hover:text-pink-700'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
      {children}
    </section>
  )
}
