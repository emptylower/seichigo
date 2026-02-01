import Link from 'next/link'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { Anime } from '@/lib/anime/getAllAnime'

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

function optimizeAssetCoverSrc(input: string, opts: { width: number; quality: number }): string {
  const raw = String(input || '').trim()
  if (!raw) return raw

  const hasAbsolute = raw.startsWith('http://') || raw.startsWith('https://')
  const base = hasAbsolute ? undefined : 'https://seichigo.com'

  try {
    const url = new URL(raw, base)
    if (!url.pathname.startsWith('/assets/')) return raw
    if (!url.searchParams.has('w')) url.searchParams.set('w', String(opts.width))
    if (!url.searchParams.has('q')) url.searchParams.set('q', String(opts.quality))
    return hasAbsolute ? url.toString() : `${url.pathname}${url.search}`
  } catch {
    return raw
  }
}

export default function AnimeCard({ anime, postCount, cover, locale = 'zh' }: Props) {
  const coverSrc = cover ? optimizeAssetCoverSrc(cover, { width: 900, quality: 78 }) : null

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
            alt={locale === 'en' && anime.name_en ? anime.name_en : locale === 'ja' && anime.name_ja ? anime.name_ja : anime.name}
            width={900}
            height={1200}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-1 text-lg font-bold text-gray-900 group-hover:text-brand-600">
          {locale === 'en' && anime.name_en ? anime.name_en : locale === 'ja' && anime.name_ja ? anime.name_ja : anime.name}
        </h3>
        <p className="mt-1 line-clamp-2 min-h-[2.5em] text-sm text-gray-500">
          {locale === 'en' && anime.summary_en ? anime.summary_en : locale === 'ja' && anime.summary_ja ? anime.summary_ja : anime.summary || '暂无简介'}
        </p>

        <div className="mt-auto flex items-center justify-between pt-3 text-xs font-medium text-gray-400">
          <span className={postCount > 0 ? 'text-brand-600' : ''}>
            {postCount} {locale === 'en' ? 'posts' : locale === 'ja' ? '件の記事' : '篇文章'}
          </span>
          {anime.year ? <span>{anime.year}</span> : null}
        </div>
      </div>
    </Link>
  )
}
