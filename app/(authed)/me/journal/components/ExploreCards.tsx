import { StitchedBorder } from '../primitives/StitchedBorder'

const CARDS = [
  {
    href: '/map',
    icon: '⊕',
    title: '探索地图',
    body: '在 8,500+ 处巡礼点位中游走。按作品筛选、精简模式、街景一键切换。',
    cta: '前往目的地',
    badge: null as string | null,
  },
  {
    href: '/routes',
    icon: '⇢',
    title: '看看大家在逛什么',
    body: '编辑部和老巡礼者整理好的现成行程，一键加入我的行程。',
    cta: '前往路线',
    badge: null,
  },
  {
    href: '/posts',
    icon: '≡',
    title: '精选旅游攻略',
    body: '配机位 / 时间戳 / 对比图的深度向导，看完直接加入行程。',
    cta: '前往攻略',
    badge: null,
  },
  {
    href: '#nearby',
    icon: '◎',
    title: '看看身边有什么',
    body: '基于当前定位，找步行范围内的取景地。已经在日本时最好用。',
    cta: '唤起浮层',
    badge: '附近',
  },
] as const

export function ExploreCards() {
  return (
    <section className="mb-16">
      <div className="flex items-end gap-6 mb-8">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-lg">Explore</div>
          <h2 className="font-journal-serif font-bold text-3xl tracking-wide">探索</h2>
        </div>
        <div className="flex-1 h-px bg-journal-thread mb-3" />
        <div className="text-xs text-journal-ink-muted mb-3 tracking-[2px]">
          从手帐出发，把新的内容带回来
        </div>
      </div>

      <div className="grid grid-cols-4 gap-5">
        {CARDS.map((c) => (
          <a
            key={c.title}
            href={c.href}
            className="block cursor-pointer transition hover:bg-journal-paper-card/60 group"
          >
            <StitchedBorder className="p-6 relative h-full">
              {c.badge ? (
                <span className="absolute top-3 right-3 text-[9px] tracking-[2px] text-journal-seal border border-journal-seal px-1.5 py-0.5">
                  {c.badge}
                </span>
              ) : null}
              <div className="text-2xl font-journal-serif text-journal-ink-soft mb-3">{c.icon}</div>
              <div className="font-journal-serif text-lg font-bold mb-2">{c.title}</div>
              <div className="text-[11px] text-journal-ink-muted mb-5 leading-relaxed">{c.body}</div>
              <div className="text-[11px] text-journal-seal tracking-wider group-hover:translate-x-1 transition">
                {c.cta} →
              </div>
            </StitchedBorder>
          </a>
        ))}
      </div>
    </section>
  )
}
