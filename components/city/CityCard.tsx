import Link from 'next/link'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { assetCoverSrc, assetCoverSrcSet } from '@/lib/asset/coverSrc'
import { getLocalizedDisplayName } from '@/lib/i18n/displayName'

type Props = {
  city: {
    id: string
    slug: string
    name_zh: string
    name_en?: string | null
    name_ja?: string | null
    description_zh?: string | null
    description_en?: string | null
    description_ja?: string | null
    cover?: string | null
  }
  postCount: number
  locale?: SiteLocale
}

function hash32(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function coverGradient(seedKey: string): string {
  const seed = hash32(seedKey)
  const hue1 = seed % 360
  const hue2 = (hue1 + 24 + (seed % 40)) % 360
  return `linear-gradient(135deg, hsl(${hue1} 55% 46%), hsl(${hue2} 70% 56%))`
}

/** 城市索引网格（grid-cols-1 sm:2 lg:3，容器 max-w-7xl）里卡片的实际渲染宽度 */
const COVER_SIZES = '(min-width:1024px) 400px, (min-width:640px) 50vw, 100vw'

export default function CityCard({ city, postCount, locale = 'zh' }: Props) {
  const coverRaw = typeof city.cover === 'string' && city.cover.trim() ? city.cover.trim() : null
  const coverSrc = coverRaw ? assetCoverSrc(coverRaw, { width: 640 }) : null
  const coverSrcSet = coverRaw ? assetCoverSrcSet(coverRaw, [320, 640, 960]) : undefined
  const seedKey = city.slug || city.id
  const displayName = getLocalizedDisplayName(city, locale)

  const description =
    locale === 'en'
      ? city.description_en || city.description_zh || '—'
      : locale === 'ja'
        ? city.description_ja || city.description_zh || city.description_en || '—'
        : city.description_zh || '—'

  return (
    <Link
      href={prefixPath(`/city/${encodeURIComponent(city.slug)}`, locale)}
      className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:ring-pink-100"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100">
        <div className="absolute inset-0 transition-transform duration-700 group-hover:scale-105" style={{ background: coverGradient(seedKey) }} />
        {coverSrc ? (
          <img
            src={coverSrc}
            srcSet={coverSrcSet}
            sizes={COVER_SIZES}
            alt={displayName}
            width={640}
            height={480}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <h3 className="line-clamp-1 text-base font-bold text-gray-900 group-hover:text-brand-600 sm:text-lg">
          {displayName}
        </h3>
        <p className="mt-1 line-clamp-2 min-h-[2.2em] text-xs text-gray-500 sm:min-h-[2.5em] sm:text-sm">{description}</p>

        <div className="mt-auto flex items-center justify-between pt-2 text-[11px] font-medium text-gray-400 sm:pt-3 sm:text-xs">
          <span className={postCount > 0 ? 'text-brand-600' : ''}>
            {postCount} {locale === 'en' ? 'posts' : locale === 'ja' ? '件の記事' : '篇文章'}
          </span>
          {city.name_en ? <span className="text-gray-500">{city.name_en}</span> : null}
        </div>
      </div>
    </Link>
  )
}
