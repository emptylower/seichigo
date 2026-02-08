import Link from 'next/link'
import CityCard from '@/components/city/CityCard'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomePopularCityItem } from '@/lib/home/types'
import { t } from '@/lib/i18n'

export default function HomePopularCities({
  items,
  locale,
}: {
  items: HomePopularCityItem[]
  locale: SiteLocale
}) {
  if (!items.length) return null

  return (
    <section className="space-y-6 max-w-7xl mx-auto px-6">
      <div className="flex items-center justify-between px-1 border-l-4 border-brand-500 pl-3">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">{t('pages.home.popularCityTitle', locale)}</h2>
        <Link href={prefixPath('/city', locale)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
          {t('pages.home.viewAllCityLink', locale)}
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <CityCard key={item.city.id} city={item.city} postCount={item.postCount} locale={locale} />
        ))}
      </div>
    </section>
  )
}
