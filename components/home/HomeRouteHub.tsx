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
    <section className="mx-auto max-w-7xl space-y-6 px-4 sm:px-6">
      <div className="space-y-2 border-l-4 border-brand-500 pl-3">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">{t('pages.home.mapHubTitle', locale)}</h2>
        <p className="max-w-3xl text-sm text-gray-600 sm:text-base">{t('pages.home.mapHubSubtitle', locale)}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Link
          href={prefixPath('/map', locale)}
          className="group relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-xl transition-all hover:-translate-y-0.5 hover:shadow-2xl sm:p-8"
        >
          <div className="pointer-events-none absolute -right-8 -top-12 h-44 w-44 rounded-full bg-brand-400/35 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 left-8 h-52 w-52 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background:linear-gradient(135deg,#fff_0%,transparent_50%,#fff_100%)]" />

          <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-slate-100">
            {t('pages.home.mapHubPrimaryBadge', locale)}
          </span>
          <h3 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            {t('pages.home.mapHubPrimaryTitle', locale)}
          </h3>
          <p className="mt-3 max-w-xl text-sm leading-7 text-slate-200 sm:text-base">
            {t('pages.home.mapHubPrimaryDesc', locale)}
          </p>

          <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-slate-100/90">
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">{t('pages.home.mapHubChipAnime', locale)}</span>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">{t('pages.home.mapHubChipCity', locale)}</span>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">{t('pages.home.mapHubChipSpot', locale)}</span>
          </div>

          <div className="mt-8 inline-flex items-center text-sm font-semibold text-brand-200 transition-colors group-hover:text-white">
            {t('pages.home.mapHubPrimaryCta', locale)}
          </div>
        </Link>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
          {QUICK_LINKS.map((item) => (
            <Link
              key={item.id}
              href={prefixPath(item.href, locale)}
              className={`group rounded-2xl border bg-gradient-to-br ${item.accentClass} p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md`}
            >
              <h3 className="text-base font-semibold text-gray-900">{t(item.titleKey, locale)}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">{t(item.descKey, locale)}</p>
              <div className="mt-4 inline-flex items-center text-sm font-semibold text-brand-700 group-hover:text-brand-800">
                {t(item.ctaKey, locale)}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
