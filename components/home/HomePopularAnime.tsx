import Link from 'next/link'
import AnimeCard from '@/components/anime/AnimeCard'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomePopularAnimeItem } from '@/lib/home/types'
import { t } from '@/lib/i18n'

export default function HomePopularAnime({
  items,
  locale,
}: {
  items: HomePopularAnimeItem[]
  locale: SiteLocale
}) {
  if (!items.length) return null

  return (
    <section className="space-y-6 max-w-7xl mx-auto px-6">
      <div className="flex items-center justify-between px-1 border-l-4 border-brand-500 pl-3">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">{t('pages.home.popularAnimeTitle', locale)}</h2>
        <Link href={prefixPath('/anime', locale)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
          {t('pages.home.viewAllAnimeLinkAlt', locale)}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((item) => (
          <AnimeCard
            key={item.anime.id}
            anime={item.anime}
            postCount={item.postCount}
            cover={item.cover}
            locale={locale}
          />
        ))}
      </div>
    </section>
  )
}
