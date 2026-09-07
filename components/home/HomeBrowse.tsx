import Link from 'next/link'
import { ArrowRight, BookOpen, Clapperboard, MapPin } from 'lucide-react'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { assetCoverSrc, assetCoverSrcSet } from '@/lib/asset/coverSrc'
import type { HomePopularAnimeItem, HomePopularCityItem } from '@/lib/home/types'
import { getLocalizedDisplayName } from '@/lib/i18n/displayName'
import { t } from '@/lib/i18n'

/** 作品栏最多 8 个（4 列 × 2 行），城市栏最多 12 个（4 列 × 3 行） */
const MAX_ANIME_CARDS = 8
const MAX_CITY_CARDS = 12

/** 大标题「热门作品 & 热门城市」：& 是唯一的品牌色片段（模板里的 {amp} 占位） */
function BrowseHeading({ locale }: { locale: SiteLocale }) {
  const [before = '', after = ''] = t('pages.home.v2.browseHeading', locale).split('{amp}')
  return (
    <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 lg:text-4xl">
      {before}
      <span data-browse-amp className="text-brand-600">
        &amp;
      </span>
      {after}
    </h2>
  )
}

/** 「攻略 {n} 篇」浅粉胶囊；postCount 为 0 时不显示（不显示「0 篇」） */
function GuideCountCapsule({ count, locale }: { count: number; locale: SiteLocale }) {
  if (count <= 0) return null
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
      <BookOpen className="h-3 w-3" aria-hidden="true" />
      {t('pages.home.v2.browseGuideCount', locale).replace('{count}', String(count))}
    </span>
  )
}

/** 竖版海报卡（作品）：无封面用浅粉渐变占位 */
function AnimePosterCard({ item, locale }: { item: HomePopularAnimeItem; locale: SiteLocale }) {
  const name = getLocalizedDisplayName(item.anime, locale)
  return (
    <Link href={prefixPath(`/anime/${encodeURIComponent(item.anime.id)}`, locale)} className="group no-underline">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-gradient-to-br from-brand-100 to-pink-50">
        {item.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetCoverSrc(item.cover, { width: 640 })}
            srcSet={assetCoverSrcSet(item.cover, [320, 640, 960])}
            sizes="(min-width:1024px) 120px, 45vw"
            alt={name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : null}
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-gray-900 group-hover:text-brand-600">{name}</p>
      <GuideCountCapsule count={item.postCount} locale={locale} />
    </Link>
  )
}

/** 横版封面卡（城市）：无封面用浅粉渐变 + 居中城市名首字 */
function CityCoverCard({ item, locale }: { item: HomePopularCityItem; locale: SiteLocale }) {
  const name = getLocalizedDisplayName(item.city, locale)
  return (
    <Link href={prefixPath(`/city/${encodeURIComponent(item.city.slug)}`, locale)} className="group no-underline">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-brand-100 to-pink-50">
        {item.city.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetCoverSrc(item.city.cover, { width: 640 })}
            srcSet={assetCoverSrcSet(item.city.cover, [320, 640, 960])}
            sizes="(min-width:1024px) 120px, 45vw"
            alt={name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-brand-300">
            {name.charAt(0)}
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-gray-900 group-hover:text-brand-600">{name}</p>
      <GuideCountCapsule count={item.postCount} locale={locale} />
    </Link>
  )
}

function ColumnHeader({
  icon: Icon,
  title,
  desc,
  moreHref,
  moreLabel,
}: {
  icon: typeof Clapperboard
  title: string
  desc: string
  moreHref: string
  moreLabel: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          {title}
        </p>
        <p className="mt-1 text-xs text-gray-500">{desc}</p>
      </div>
      <Link
        href={moreHref}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-200 px-3.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
      >
        {moreLabel}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  )
}

/**
 * 第五屏「热门作品 & 热门城市」（本轮重做）：居中标题 + 左右两栏。
 * 不再复用列表页的 AnimeCard / CityCard——作品是竖版海报卡、城市是横版封面卡，
 * 名字按 locale 取（与卡片组件同一个 getLocalizedDisplayName），链接规则与它们一致；
 * 「攻略 n 篇」胶囊的数字就是真实 postCount，0 时不显示。
 */
export default function HomeBrowse({
  locale,
  anime,
  cities,
}: {
  locale: SiteLocale
  anime: HomePopularAnimeItem[]
  cities: HomePopularCityItem[]
}) {
  if (!anime.length && !cities.length) return null

  return (
    <section>
      <div className="text-center">
        <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.v2.browseEyebrow', locale)}</p>
        <div className="mt-3">
          <BrowseHeading locale={locale} />
        </div>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-600 sm:text-base">
          {t('pages.home.v2.browseSubtitle', locale)}
        </p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        {anime.length ? (
          <div>
            <ColumnHeader
              icon={Clapperboard}
              title={t('pages.home.v2.browseAnimeTitle', locale)}
              desc={t('pages.home.v2.browseAnimeDesc', locale)}
              moreHref={prefixPath('/anime', locale)}
              moreLabel={t('pages.home.v2.browseAnimeMore', locale)}
            />
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {anime.slice(0, MAX_ANIME_CARDS).map((item) => (
                <AnimePosterCard key={item.anime.id} item={item} locale={locale} />
              ))}
            </div>
          </div>
        ) : null}
        {cities.length ? (
          <div>
            <ColumnHeader
              icon={MapPin}
              title={t('pages.home.v2.browseCityTitle', locale)}
              desc={t('pages.home.v2.browseCityDesc', locale)}
              moreHref={prefixPath('/city', locale)}
              moreLabel={t('pages.home.v2.browseCityMore', locale)}
            />
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {cities.slice(0, MAX_CITY_CARDS).map((item) => (
                <CityCoverCard key={item.city.id} item={item} locale={locale} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
