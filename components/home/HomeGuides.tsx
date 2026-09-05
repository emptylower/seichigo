import Link from 'next/link'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { PublicPostListItem } from '@/lib/posts/types'
import { t } from '@/lib/i18n'

function metaLine(item: PublicPostListItem, locale: SiteLocale): string {
  const animeNames = item.localizedAnimeNames?.length ? item.localizedAnimeNames : item.animeIds
  const names = animeNames.filter((name) => name && name !== 'unknown').join(locale === 'en' ? ', ' : '、')
  return [names, item.localizedCity ?? item.city, item.routeLength].filter(Boolean).join(' · ')
}

function GuideCard({
  item,
  locale,
  size,
}: {
  item: PublicPostListItem
  locale: SiteLocale
  size: 'large' | 'small'
}) {
  const large = size === 'large'
  return (
    <Link
      href={item.path}
      data-guide-size={size}
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white no-underline transition-colors ${
        large ? 'border-brand-200 hover:border-brand-400' : 'border-gray-200 hover:border-brand-300'
      }`}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-brand-100 to-pink-50">
        {item.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.cover}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading={large ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : null}
      </div>
      <div className="space-y-1 p-4">
        <h3
          className={`line-clamp-2 font-bold leading-snug text-gray-900 group-hover:text-brand-600 ${
            large ? 'text-lg sm:text-xl' : 'text-base'
          }`}
        >
          {item.title}
        </h3>
        <div className="line-clamp-1 text-xs text-gray-500">{metaLine(item, locale)}</div>
      </div>
    </Link>
  )
}

/**
 * 攻略段三行共 8 张卡：首行 2 张大卡（16:9 封面、标题更重），其余按 3 列排成两行小卡。
 * 顺序由 A 部分的 `data.guides` 决定（《你的名字。》那篇置顶），这里不再排序；
 * 不足 8 篇时小卡区按实际数量渲染，不补空位。
 */
export default function HomeGuides({ locale, items }: { locale: SiteLocale; items: PublicPostListItem[] }) {
  if (!items.length) return null

  const leads = items.slice(0, 2)
  const rest = items.slice(2)

  return (
    <section className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
      <div className="flex items-center justify-between border-l-4 border-brand-500 pl-3">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{t('pages.home.v2.guidesTitle', locale)}</h2>
        <Link href={prefixPath('/posts', locale)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
          {t('pages.home.v2.guidesViewAll', locale)}
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {leads.map((item) => (
          <GuideCard key={item.path} item={item} locale={locale} size="large" />
        ))}
      </div>
      {rest.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {rest.map((item) => (
            <GuideCard key={item.path} item={item} locale={locale} size="small" />
          ))}
        </div>
      ) : null}
    </section>
  )
}
