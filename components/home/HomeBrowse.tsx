import Link from 'next/link'
import AnimeCard from '@/components/anime/AnimeCard'
import CityCard from '@/components/city/CityCard'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomePopularAnimeItem, HomePopularCityItem } from '@/lib/home/types'
import { t } from '@/lib/i18n'

/**
 * 「按作品和城市浏览」：热门作品与热门城市合并成一段（第十二轮把原来的两段
 * 收成一屏），卡片仍复用 AnimeCard / CityCard。
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
    <section className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
      <div className="border-l-4 border-brand-500 pl-3">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{t('pages.home.v2.browseTitle', locale)}</h2>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {anime.length ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{t('pages.home.v2.browseAnimeTitle', locale)}</h3>
              <Link href={prefixPath('/anime', locale)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                {t('pages.home.v2.browseAnimeMore', locale)}
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {anime.map((item) => (
                <AnimeCard key={item.anime.id} anime={item.anime} postCount={item.postCount} cover={item.cover} locale={locale} />
              ))}
            </div>
          </div>
        ) : null}
        {cities.length ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{t('pages.home.v2.browseCityTitle', locale)}</h3>
              <Link href={prefixPath('/city', locale)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                {t('pages.home.v2.browseCityMore', locale)}
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {cities.map((item) => (
                <CityCard key={item.city.id} city={item.city} postCount={item.postCount} locale={locale} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
