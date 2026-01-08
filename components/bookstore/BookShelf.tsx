import Link from 'next/link'
import type { PublicPostListItem } from '@/lib/posts/types'
import BookCover from './BookCover'

function formatLine(item: Pick<PublicPostListItem, 'animeIds' | 'city'>): string {
  const animeLabel = item.animeIds?.length ? item.animeIds.join('、') : 'unknown'
  const parts = [animeLabel, item.city].filter(Boolean)
  return parts.join(' · ')
}

function SkeletonTile({ seed }: { seed: number }) {
  const hue = (seed * 47) % 360
  return (
    <div className="w-36 shrink-0">
      <div
        className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-black/5 shadow-sm"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 40% 92%), hsl(${(hue + 28) % 360} 50% 86%))`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-black/0 to-black/0" />
        <div className="absolute inset-x-3 bottom-3 space-y-2">
          <div className="h-3 w-3/4 rounded bg-white/60" />
          <div className="h-2 w-2/3 rounded bg-white/50" />
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <div className="h-4 w-11/12 rounded bg-gray-100" />
        <div className="h-3 w-2/3 rounded bg-gray-100" />
      </div>
    </div>
  )
}

function BookTile({ item }: { item: PublicPostListItem }) {
  return (
    <Link href={item.path} className="group w-36 shrink-0 no-underline hover:no-underline">
      <BookCover
        path={item.path}
        title={item.title}
        animeIds={item.animeIds}
        city={item.city}
        routeLength={item.routeLength}
        publishDate={item.publishDate}
        cover={item.cover}
      />
      <div className="mt-2 space-y-1">
        <div className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900 group-hover:text-brand-700">
          {item.title}
        </div>
        <div className="text-xs text-gray-500">{formatLine(item) || '—'}</div>
      </div>
    </Link>
  )
}

export default function BookShelf({ items }: { items: PublicPostListItem[] }) {
  if (!items?.length) {
    return (
      <div className="space-y-3">
        <div className="flex gap-4 overflow-x-auto pb-2 pr-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {Array.from({ length: 8 }).map((_, idx) => (
            <SkeletonTile key={idx} seed={idx + 1} />
          ))}
        </div>
        <div className="text-sm text-gray-500">暂无文章内容，先用投稿把书架填满吧。</div>
      </div>
    )
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 pr-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => (
        <BookTile key={item.path} item={item} />
      ))}
    </div>
  )
}
