import Link from 'next/link'
import type { PublicPostListItem } from '@/lib/posts/types'
import Tag from '@/components/shared/Tag'
import BookCover from './BookCover'

function formatMeta(item: Pick<PublicPostListItem, 'animeIds' | 'city' | 'routeLength' | 'publishDate'>): string {
  const animeLabel = item.animeIds?.length ? item.animeIds.join('、') : 'unknown'
  const parts = [animeLabel, item.city, item.routeLength, item.publishDate].filter(Boolean)
  return parts.join(' · ')
}

export default function FeaturedPost({ item }: { item: PublicPostListItem }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-pink-100 bg-white shadow-sm">
      <div className="grid gap-6 p-6 md:grid-cols-[240px,1fr]">
        <div className="mx-auto w-44 md:w-full">
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

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-xs font-medium text-brand-700">本周精选</div>
            <h2 className="text-2xl font-bold leading-snug">{item.title}</h2>
            <div className="text-sm text-gray-600">{formatMeta(item) || '—'}</div>
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
              开始阅读
            </Link>
            <Link href="/anime" className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 no-underline hover:bg-gray-50 hover:no-underline">
              逛逛作品
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
