import Link from 'next/link'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { Anime } from '@/lib/anime/getAllAnime'
import { assetCoverSrc, assetCoverSrcSet } from '@/lib/asset/coverSrc'
import { getLocalizedDisplayName } from '@/lib/i18n/displayName'

type Props = {
  anime: Anime
  postCount: number
  cover: string | null
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

/** 作品索引网格（grid-cols-2 sm:3 lg:4 xl:5，容器 max-w-7xl）里卡片的实际渲染宽度 */
const COVER_SIZES = '(min-width:1280px) 232px, (min-width:1024px) 22vw, (min-width:640px) 30vw, 45vw'

export default function AnimeCard({ anime, postCount, cover, locale = 'zh' }: Props) {
  const coverSrc = cover ? assetCoverSrc(cover, { width: 640 }) : null
  const coverSrcSet = cover ? assetCoverSrcSet(cover, [320, 640, 960]) : undefined
  const displayName = getLocalizedDisplayName(anime, locale)

  return (
    <Link
      href={prefixPath(`/anime/${encodeURIComponent(anime.id)}`, locale)}
      className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:ring-pink-100"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
        <div
          className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
          style={{ background: coverGradient(anime.id) }}
        />
        {coverSrc ? (
          <img
            src={coverSrc}
            srcSet={coverSrcSet}
            sizes={COVER_SIZES}
            alt={displayName}
            width={640}
            height={853}
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
        <p className="mt-1 line-clamp-2 min-h-[2.2em] text-xs text-gray-500 sm:min-h-[2.5em] sm:text-sm">
          {locale === 'en' && anime.summary_en ? anime.summary_en : locale === 'ja' && anime.summary_ja ? anime.summary_ja : anime.summary || '暂无简介'}
        </p>

        <div className="mt-auto flex items-center justify-between pt-2 text-[11px] font-medium text-gray-400 sm:pt-3 sm:text-xs">
          <span className={postCount > 0 ? 'text-brand-600' : ''}>
            {postCount} {locale === 'en' ? 'posts' : locale === 'ja' ? '件の記事' : '篇文章'}
          </span>
          {anime.year ? <span>{anime.year}</span> : null}
        </div>
      </div>
    </Link>
  )
}
