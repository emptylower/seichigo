import Link from 'next/link'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { t } from '@/lib/i18n'

const QUICK_LINKS = [
  {
    id: 'anime',
    href: '/anime',
    titleKey: 'pages.home.mapHubQuickAnimeTitle',
    descKey: 'pages.home.mapHubQuickAnimeDesc',
    ctaKey: 'pages.home.mapHubQuickAnimeCta',
    accentClass: 'from-brand-500/14 to-brand-50/40 border-brand-100/70',
  },
  {
    id: 'city',
    href: '/city',
    titleKey: 'pages.home.mapHubQuickCityTitle',
    descKey: 'pages.home.mapHubQuickCityDesc',
    ctaKey: 'pages.home.mapHubQuickCityCta',
    accentClass: 'from-cyan-500/14 to-sky-50/60 border-sky-100/80',
  },
  {
    id: 'resources',
    href: '/resources',
    titleKey: 'pages.home.mapHubQuickResourcesTitle',
    descKey: 'pages.home.mapHubQuickResourcesDesc',
    ctaKey: 'pages.home.mapHubQuickResourcesCta',
    accentClass: 'from-fuchsia-500/12 to-violet-50/60 border-violet-100/80',
  },
] as const

export default function HomeRouteHub({ locale }: { locale: SiteLocale }) {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="relative overflow-hidden rounded-[30px] border border-slate-200/90 bg-white p-6 shadow-[0_22px_55px_-34px_rgba(15,23,42,0.5)] sm:p-8">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [background-size:36px_36px]" />
        <div className="pointer-events-none absolute -right-28 -top-28 h-64 w-64 rounded-full bg-brand-100 blur-3xl" />

        <div className="relative mb-6 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50/70 px-3 py-1 text-xs font-semibold text-brand-700">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            {t('pages.home.mapHubPrimaryBadge', locale)}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[30px]">{t('pages.home.mapHubTitle', locale)}</h2>
          <p className="max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">{t('pages.home.mapHubSubtitle', locale)}</p>
        </div>

        <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[1.38fr_1fr]">
          <Link
            href={prefixPath('/map', locale)}
            className="group relative isolate overflow-hidden rounded-[26px] border border-slate-800/30 bg-slate-950 p-6 text-white no-underline transition-all duration-300 hover:-translate-y-0.5 hover:no-underline hover:shadow-[0_24px_45px_-30px_rgba(15,23,42,0.85)] sm:p-8"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_80%,rgba(34,211,238,0.2),transparent_38%),radial-gradient(circle_at_82%_12%,rgba(244,114,182,0.28),transparent_44%),linear-gradient(135deg,#020617_0%,#0f172a_48%,#172554_100%)]" />
            <div className="pointer-events-none absolute inset-0 opacity-[0.24] [background-image:linear-gradient(to_right,rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.22)_1px,transparent_1px)] [background-size:30px_30px]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />

            <div className="relative flex min-h-[260px] flex-col">
              <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('pages.home.mapHubPrimaryTitle', locale)}</h3>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-200 sm:text-base">{t('pages.home.mapHubPrimaryDesc', locale)}</p>

              <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-100">
                <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur">{t('pages.home.mapHubChipAnime', locale)}</span>
                <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur">{t('pages.home.mapHubChipCity', locale)}</span>
                <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur">{t('pages.home.mapHubChipSpot', locale)}</span>
              </div>

              <div className="mt-auto pt-7">
                <span className="inline-flex items-center rounded-full bg-white/14 px-4 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-white/22">
                  {t('pages.home.mapHubPrimaryCta', locale)}
                </span>
              </div>
            </div>
          </Link>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {QUICK_LINKS.map((item, index) => (
              <Link
                key={item.id}
                href={prefixPath(item.href, locale)}
                className={`group rounded-2xl border bg-gradient-to-br ${item.accentClass} p-5 no-underline shadow-[0_8px_20px_-18px_rgba(15,23,42,0.4)] transition-all duration-300 hover:-translate-y-0.5 hover:no-underline hover:shadow-[0_16px_30px_-24px_rgba(15,23,42,0.4)]`}
              >
                <div className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-white/80 px-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200/80">
                  0{index + 1}
                </div>
                <h3 className="mt-3 text-base font-semibold text-slate-900">{t(item.titleKey, locale)}</h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-600">{t(item.descKey, locale)}</p>
                <div className="mt-4 inline-flex items-center text-sm font-semibold text-brand-700 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-800">
                  {t(item.ctaKey, locale)}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
