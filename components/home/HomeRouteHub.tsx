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

type HomeRouteHubProps = {
  locale: SiteLocale
  heroImageSrc?: string
}

export default function HomeRouteHub({ locale, heroImageSrc }: HomeRouteHubProps) {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="relative overflow-hidden rounded-[30px] border border-slate-200/90 bg-[linear-gradient(160deg,rgba(255,255,255,0.94),rgba(248,250,252,0.9))] p-6 shadow-[0_22px_55px_-34px_rgba(15,23,42,0.45)] sm:p-8">
        <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-52 w-52 rounded-full bg-cyan-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 bottom-6 h-44 w-44 rounded-full bg-brand-100/70 blur-3xl" />

        <div className="relative mb-6 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50/70 px-3 py-1 text-xs font-semibold text-brand-700">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            {t('pages.home.mapHubPrimaryBadge', locale)}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[30px]">{t('pages.home.mapHubTitle', locale)}</h2>
          <p className="max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">{t('pages.home.mapHubSubtitle', locale)}</p>
        </div>

        <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[1.36fr_1fr]">
          <Link
            href={prefixPath('/map', locale)}
            className="group relative isolate overflow-hidden rounded-[28px] border border-white/60 bg-[linear-gradient(150deg,rgba(255,255,255,0.45),rgba(255,255,255,0.18))] p-4 no-underline shadow-[0_26px_42px_-30px_rgba(14,18,38,0.55)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:no-underline hover:shadow-[0_30px_48px_-30px_rgba(14,18,38,0.7)] sm:p-5"
          >
            <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.85),rgba(255,255,255,0.16)_48%),linear-gradient(132deg,rgba(13,20,43,0.07),rgba(13,20,43,0.34))]" />
            <div className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/35" />
            {heroImageSrc ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-[-6%] h-[54%] overflow-hidden">
                <img
                  src={heroImageSrc}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full scale-[1.06] object-cover object-center opacity-[0.94] saturate-[1.05]"
                />
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-[linear-gradient(to_top,rgba(2,6,23,0.74)_0%,rgba(2,6,23,0.45)_38%,rgba(248,250,252,0.18)_100%)]" />
            <div className="pointer-events-none absolute inset-0 opacity-[0.13] [background-image:linear-gradient(to_right,rgba(255,255,255,0.36)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.36)_1px,transparent_1px)] [background-size:34px_34px]" />

            <div className="relative flex min-h-[325px] flex-col justify-between gap-6 p-2 sm:min-h-[350px]">
              <div className="max-w-[560px] rounded-[24px] border border-white/55 bg-white/[0.22] p-5 text-slate-900 shadow-[0_20px_36px_-24px_rgba(15,23,42,0.58)] backdrop-blur-2xl sm:p-6">
                <h3 className="text-[30px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[36px]">
                  {t('pages.home.mapHubPrimaryTitle', locale)}
                </h3>
                <p className="mt-3 max-w-xl text-base leading-7 text-slate-700">{t('pages.home.mapHubPrimaryDesc', locale)}</p>

                <div className="mt-5 flex flex-wrap gap-2.5 text-sm font-semibold text-slate-700">
                  <span className="rounded-full border border-white/65 bg-white/45 px-3.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-lg">{t('pages.home.mapHubChipAnime', locale)}</span>
                  <span className="rounded-full border border-white/65 bg-white/45 px-3.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-lg">{t('pages.home.mapHubChipCity', locale)}</span>
                  <span className="rounded-full border border-white/65 bg-white/45 px-3.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-lg">{t('pages.home.mapHubChipSpot', locale)}</span>
                </div>
              </div>

              <div>
                <span className="inline-flex items-center rounded-full border border-white/55 bg-white/30 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-16px_rgba(15,23,42,0.65)] backdrop-blur-xl transition-all group-hover:bg-white/40 group-hover:text-slate-900">
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
                className={`group rounded-2xl border bg-gradient-to-br ${item.accentClass} p-5 no-underline shadow-[0_10px_24px_-20px_rgba(15,23,42,0.45)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:no-underline hover:shadow-[0_20px_34px_-24px_rgba(15,23,42,0.45)]`}
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
