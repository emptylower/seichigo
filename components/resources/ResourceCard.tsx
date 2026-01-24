import Link from 'next/link'
import type { LinkAssetListItem } from '@/lib/linkAsset/types'

type Props = {
  item: LinkAssetListItem
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

function typeLabel(type: LinkAssetListItem['type']): string {
  if (type === 'map') return '🗺️ 地图'
  if (type === 'checklist') return '✅ 清单'
  if (type === 'etiquette') return '🙏 礼仪'
  return '📖 指南'
}

export default function ResourceCard({ item }: Props) {
  const coverRaw = typeof item.cover === 'string' && item.cover.trim() ? item.cover.trim() : null
  const coverSrc = coverRaw ? optimizeAssetCoverSrc(coverRaw, { width: 1280, quality: 78 }) : null

  return (
    <Link
      href={`/resources/${encodeURIComponent(item.id)}`}
      className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:ring-pink-100"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
        <div className="absolute inset-0 transition-transform duration-700 group-hover:scale-105" style={{ background: coverGradient(item.id) }} />
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={item.title}
            width={1280}
            height={720}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-60 transition-opacity group-hover:opacity-70" />

        <div className="relative flex h-full flex-col justify-between p-4 text-white">
          <div className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm">
            {typeLabel(item.type)}
          </div>
          <div className="space-y-1">
            <div className="line-clamp-2 text-sm font-bold leading-tight drop-shadow-md">{item.title}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="line-clamp-2 min-h-[2.5em] text-sm text-gray-600">{item.description || '—'}</p>
      </div>
    </Link>
  )
}
