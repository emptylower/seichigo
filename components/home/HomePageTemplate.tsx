import Image from 'next/image'
import Link from 'next/link'
import BookCover from '@/components/bookstore/BookCover'
import BookShelf from '@/components/bookstore/BookShelf'
import FeaturedPost from '@/components/bookstore/FeaturedPost'
import HomePopularAnime from '@/components/home/HomePopularAnime'
import HomePopularCities from '@/components/home/HomePopularCities'
import HomeStarterSteps from '@/components/home/HomeStarterSteps'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import AppWaitlistPromoCtas from '@/components/waitlist/AppWaitlistPromoCtas.client'
import type { HomePortalData } from '@/lib/home/types'
import { t } from '@/lib/i18n'

function optimizeAssetImgSrc(input: string, opts: { width: number; quality: number }): string {
  const raw = String(input || '').trim()
  if (!raw) return raw

  const hasAbsolute = raw.startsWith('http://') || raw.startsWith('https://')
  const base = hasAbsolute ? undefined : 'https://seichigo.com'

  try {
    const url = new URL(raw, base)
    if (!url.pathname.startsWith('/assets/')) return raw
    if (!url.searchParams.has('w')) url.searchParams.set('w', String(opts.width))
    if (!url.searchParams.has('q')) url.searchParams.set('q', String(opts.quality))
    return hasAbsolute ? url.toString() : `${url.pathname}${url.search}`
  } catch {
    return raw
  }
}

function formatAnimeLine(animeIds: string[], locale: SiteLocale): string {
  if (!animeIds.length) return 'unknown'
  return animeIds.join(locale === 'en' ? ', ' : '、')
}

function coverAlt(name: string | undefined, locale: SiteLocale): string {
  const suffix = locale === 'en' ? 'cover' : locale === 'ja' ? '作品カバー' : '作品封面'
  if (name) return `${name} ${suffix}`
  if (locale === 'en') return 'Anime cover'
  if (locale === 'ja') return '作品カバー'
  return '作品封面'
}

export default function HomePageTemplate({ locale, data }: { locale: SiteLocale; data: HomePortalData }) {
  return (
    <div className="space-y-16 pb-12">
      <section className="relative px-6 py-12 md:py-20 lg:px-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50/50 to-purple-50/30 -z-10" />
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center max-w-7xl mx-auto">
          <div className="space-y-8 text-center lg:text-left">
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl leading-tight">
              {t('pages.home.heroTitle', locale)}
              <br />
              {t('pages.home.heroTitleLine2', locale)}
            </h1>
            <p className="max-w-lg mx-auto lg:mx-0 text-lg text-gray-600 sm:text-xl leading-relaxed">
              {t('pages.home.heroSubtitle', locale)}
              <br className="hidden sm:block" />
              {t('pages.home.heroSubtitleLine2', locale)}
            </p>
            <div className="flex flex-wrap justify-center lg:justify-start gap-4 pt-2">
              <Link
                href={prefixPath('/anime', locale)}
                className="rounded-full bg-brand-600 px-6 py-4 text-sm font-semibold text-white shadow-lg shadow-brand-200 transition-all hover:bg-brand-700 hover:shadow-xl hover:-translate-y-0.5"
              >
                {t('pages.home.browseAnimeButton', locale)}
              </Link>
              <Link
                href={prefixPath('/submit', locale)}
                className="rounded-full border border-gray-200 bg-white px-6 py-4 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-900"
              >
                {t('pages.home.submitButton', locale)}
              </Link>
            </div>
          </div>

          <div className="relative hidden lg:block h-[400px]">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md h-80">
              {data.heroDisplay.map((item, i) => {
                const imgSrc = optimizeAssetImgSrc(item.src, { width: 640, quality: 72 })
                return (
                  <div
                    key={i}
                    className="absolute top-0 w-64 aspect-[3/4] rounded-xl shadow-2xl transition-transform hover:scale-105 duration-500 ease-out"
                    style={{
                      left: `${50 + (i - 1) * 25}%`,
                      top: `${(i - 1) * 20}px`,
                      transform: `translateX(-50%) rotate(${(i - 1) * 12}deg)`,
                      zIndex: 3 - i,
                    }}
                  >
                    <div className="relative h-full w-full overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
                      <img
                        src={imgSrc}
                        alt={coverAlt(item.name, locale)}
                        width={640}
                        height={853}
                        className="h-full w-full object-cover"
                        loading="eager"
                        decoding="async"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-30" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <HomeStarterSteps steps={data.starterSteps} locale={locale} />

      {data.featured ? (
        <section className="space-y-6 max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-2 px-1 border-l-4 border-brand-500 pl-3">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">{t('pages.home.featuredSectionTitle', locale)}</h2>
          </div>
          <FeaturedPost item={data.featured} locale={locale} />
        </section>
      ) : null}

      <HomePopularAnime items={data.popularAnime} locale={locale} />

      <section className="space-y-6 max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between px-1 border-l-4 border-brand-500 pl-3">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">{t('pages.home.latestSectionTitle', locale)}</h2>
          <Link href={prefixPath('/anime', locale)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            {t('pages.home.viewAllAnimeLink', locale)}
          </Link>
        </div>
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
          <BookShelf items={data.latestShelf} locale={locale} />
        </div>
      </section>

      <HomePopularCities items={data.popularCities} locale={locale} />

      {data.more.length ? (
        <section className="space-y-6 max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between px-1 border-l-4 border-brand-500 pl-3">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">{t('pages.home.exploreSectionTitle', locale)}</h2>
            <Link href={prefixPath('/anime', locale)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
              {t('pages.home.goToAnimeIndexLink', locale)}
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.more.map((p) => (
              <Link
                key={p.path}
                href={p.path}
                className="group flex flex-col gap-3 no-underline hover:no-underline"
              >
                <BookCover
                  path={p.path}
                  title={p.title}
                  animeIds={p.animeIds}
                  city={p.city}
                  routeLength={p.routeLength}
                  publishDate={p.publishDate}
                  cover={p.cover}
                />
                <div className="space-y-1 px-1">
                  <div className="line-clamp-2 text-lg font-bold leading-snug text-gray-900 group-hover:text-brand-600">
                    {p.title}
                  </div>
                  <div className="text-sm text-gray-500">
                    {[formatAnimeLine(p.animeIds || [], locale), p.city].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="max-w-7xl mx-auto px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gray-900 px-6 py-12 shadow-2xl sm:px-12 md:py-16">
          <div className="absolute top-0 right-0 -mt-20 -mr-20 h-80 w-80 rounded-full bg-brand-500 opacity-20 blur-3xl" />
          <div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-80 w-80 rounded-full bg-purple-500 opacity-20 blur-3xl" />

          <div className="relative z-10 flex flex-col items-center justify-between gap-8 md:flex-row">
            <div className="flex-1 space-y-6 text-center md:text-left">
              <div className="flex flex-col items-center gap-5 md:flex-row md:items-start">
                <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 shadow-inner ring-1 ring-white/20 backdrop-blur-md">
                  <Image
                    src="/brand/app-logo.png"
                    alt="SeichiGo App Logo"
                    width={56}
                    height={56}
                    className="rounded-xl shadow-lg"
                  />
                </span>
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-center gap-3 md:justify-start">
                    <h2 className="text-3xl font-bold text-white tracking-tight">{t('pages.home.appPromoTitle', locale)}</h2>
                    <span className="rounded-full bg-brand-500/20 px-3 py-1 text-xs font-bold text-brand-300 ring-1 ring-brand-500/50 backdrop-blur-md">
                      {t('pages.home.appPromoComingSoon', locale)}
                    </span>
                  </div>
                  <p className="max-w-lg text-base leading-relaxed text-gray-300">
                    {t('pages.home.appPromoDescription', locale)}
                    <span className="text-white font-medium">{t('pages.home.appPromoOfflineMap', locale)}</span>
                    {t('pages.home.appPromoAnd', locale)}
                    <span className="text-white font-medium">{t('pages.home.appPromoNavigation', locale)}</span>
                    {locale === 'ja' || locale === 'zh' ? '。' : '.'}
                    <br className="hidden sm:block" />
                    {t('pages.home.appPromoDescriptionLine2', locale)}
                  </p>
                </div>
              </div>
            </div>

            <AppWaitlistPromoCtas />
          </div>
        </div>
      </section>
    </div>
  )
}
