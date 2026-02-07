import { getResourceRouteGroups } from '@/lib/resources/aggregateRoutes'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { buildZhAlternates } from '@/lib/seo/alternates'
import RouteDirectory from '@/components/resources/RouteDirectory'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '巡礼资源｜作品路线地图总览',
  description:
    '按作品汇总站内文章的路线地图与点位清单，支持引用整条路线或单个点位，适合作为外链落地入口。',
  alternates: buildZhAlternates({ path: '/resources' }),
  openGraph: {
    type: 'website',
    url: '/resources',
    title: '巡礼资源',
    description:
      '按作品汇总站内文章的路线地图与点位清单，支持引用整条路线或单个点位，适合作为外链落地入口。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '巡礼资源',
    description:
      '按作品汇总站内文章的路线地图与点位清单，支持引用整条路线或单个点位，适合作为外链落地入口。',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default async function ResourcesIndexPage() {
  const [groups, anime] = await Promise.all([getResourceRouteGroups('zh'), getAllAnime()])
  const groupedAnimeIds = new Set(groups.map((g) => g.animeId))
  const upcomingAnime = anime
    .filter((a) => {
      const id = String(a.id || '').trim()
      return id && !groupedAnimeIds.has(id)
    })
    .map((a) => ({
      id: String(a.id || '').trim(),
      name: String(a.name || a.id || '').trim(),
      cover: typeof a.cover === 'string' ? a.cover : null,
    }))
    .slice(0, 9)
  const totalRoutes = groups.reduce((sum, g) => sum + g.routeCount, 0)
  const totalSpots = groups.reduce((sum, g) => sum + g.routes.reduce((acc, r) => acc + r.spots.length, 0), 0)

  return (
    <div className="space-y-10">
      <section className="relative isolate overflow-hidden rounded-[2rem] border border-slate-200/80 bg-slate-950 text-white shadow-[0_24px_70px_-34px_rgba(15,23,42,0.9)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(244,114,182,0.35),transparent_42%),radial-gradient(circle_at_88%_76%,rgba(56,189,248,0.26),transparent_40%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(15,23,42,0.92),rgba(30,41,59,0.84),rgba(15,23,42,0.92))]" />
        <div className="absolute -left-16 top-10 h-40 w-40 rounded-full border border-white/15 bg-white/10 blur-2xl" />
        <div className="absolute -right-20 bottom-0 h-56 w-56 rounded-full border border-brand-200/20 bg-brand-300/20 blur-3xl" />

        <div className="relative z-10 p-7 md:p-10">
          <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-white/85 backdrop-blur-sm">
            SEICHIGO ROUTE ATLAS
          </p>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">巡礼资源中心</h1>
          <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-100/90 md:text-base">
            这里按作品聚合站内文章的“总路线图”，每条路线都可一键打开地图、引用外链，并支持精确到单个点位的分享。
            后续新增作品时会自动补充到目录中。
          </p>

          <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
              <div className="text-[11px] text-white/70">已上线作品</div>
              <div className="mt-1 text-xl font-semibold text-white">{groups.length}</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
              <div className="text-[11px] text-white/70">总路线</div>
              <div className="mt-1 text-xl font-semibold text-white">{totalRoutes}</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
              <div className="text-[11px] text-white/70">可用点位</div>
              <div className="mt-1 text-xl font-semibold text-white">{totalSpots}</div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
              <div className="text-[11px] text-white/70">待上线作品</div>
              <div className="mt-1 text-xl font-semibold text-white">{upcomingAnime.length}</div>
            </div>
          </div>
        </div>
      </section>

      <div>
        <RouteDirectory groups={groups} locale="zh" upcomingAnime={upcomingAnime} />
      </div>
    </div>
  )
}
