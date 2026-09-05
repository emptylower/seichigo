import Link from 'next/link'
import BookCover from '@/components/bookstore/BookCover'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { PublicPostListItem } from '@/lib/posts/types'
import { t } from '@/lib/i18n'

function metaLine(item: PublicPostListItem, locale: SiteLocale): string {
  const animeNames = item.localizedAnimeNames?.length ? item.localizedAnimeNames : item.animeIds
  const names = (animeNames || []).filter((name) => name && name !== 'unknown').join(locale === 'en' ? ', ' : '、')
  return [names, item.localizedCity ?? item.city, item.publishDate].filter(Boolean).join(' · ')
}

/** 攻略索引页：按发布时间倒序全量列出已发布攻略（首页只放前几篇，这里是全集）。 */
export default function PostsIndexTemplate({
  locale,
  items,
}: {
  locale: SiteLocale
  items: PublicPostListItem[]
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2 border-l-4 border-brand-500 pl-3">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{t('pages.posts.title', locale)}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-gray-600">{t('pages.posts.subtitle', locale)}</p>
      </header>

      {items.length ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link key={item.path} href={item.path} className="group flex flex-col gap-3 no-underline hover:no-underline">
              <BookCover
                path={item.path}
                title={item.title}
                animeIds={item.animeIds}
                localizedAnimeNames={item.localizedAnimeNames}
                city={item.city}
                localizedCity={item.localizedCity}
                routeLength={item.routeLength}
                publishDate={item.publishDate}
                cover={item.cover}
              />
              <div className="space-y-1 px-1">
                <div className="line-clamp-2 text-lg font-bold leading-snug text-gray-900 group-hover:text-brand-600">
                  {item.title}
                </div>
                <div className="text-sm text-gray-500">{metaLine(item, locale) || '—'}</div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-12 text-center text-sm text-gray-500">
          {t('pages.posts.empty', locale)}
        </div>
      )}
    </div>
  )
}
