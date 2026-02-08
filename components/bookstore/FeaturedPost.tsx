import Link from 'next/link'
import type { PublicPostListItem } from '@/lib/posts/types'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { t } from '@/lib/i18n'
import { prefixPath } from '@/components/layout/prefixPath'
import Tag from '@/components/shared/Tag'
import BookCover from './BookCover'

function formatMeta(item: Pick<PublicPostListItem, 'animeIds' | 'city' | 'routeLength' | 'publishDate'>): string {
  const animeLabel = item.animeIds?.length ? item.animeIds.join('、') : 'unknown'
  const parts = [animeLabel, item.city, item.routeLength, item.publishDate].filter(Boolean)
  return parts.join(' · ')
}

export default function FeaturedPost({ item, locale }: { item: PublicPostListItem; locale: SiteLocale }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition-all hover:shadow-md">
      <div className="grid gap-6 md:grid-cols-2 md:items-center">
        <div className="relative w-full">
          {/* Cover Image Container - full width/height on mobile, specific aspect on desktop if needed, but BookCover handles aspect */}
          <div className="p-4 md:p-6 md:pr-0">
             <BookCover
              path={item.path}
              title={item.title}
              animeIds={item.animeIds}
              city={item.city}
              routeLength={item.routeLength}
              publishDate={item.publishDate}
              cover={item.cover}
              variant="featured"
            />
          </div>
        </div>

        <div className="space-y-4 p-6 pt-0 md:p-8 md:pl-0">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                {t('pages.components.featuredPost.featuredBadge', locale)}
              </span>
            </div>
            <h2 className="text-2xl font-bold leading-tight tracking-tight text-gray-900 md:text-3xl">
              {item.title}
            </h2>
            <div className="text-sm text-gray-500">{formatMeta(item) || '—'}</div>
          </div>

          {item.tags?.length ? (
            <div className="flex flex-wrap gap-2">
              {item.tags.slice(0, 8).map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Link href={item.path} className="btn-primary no-underline hover:no-underline">
              {t('pages.components.featuredPost.readButton', locale)}
            </Link>
            <Link
              href={prefixPath('/anime', locale)}
              className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 no-underline hover:bg-gray-50 hover:no-underline"
            >
              {t('pages.components.featuredPost.browseButton', locale)}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
