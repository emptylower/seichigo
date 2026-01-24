type Props = {
  path: string
  title: string
  animeIds: string[]
  city?: string | null
  routeLength?: string | null
  publishDate?: string | null
  cover?: string | null
  variant?: 'shelf' | 'featured'
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

function formatMeta(meta: { city?: string | null; routeLength?: string | null; publishDate?: string | null }): string {
  const parts = [meta.city || '', meta.routeLength || '', meta.publishDate || ''].filter(Boolean)
  return parts.join(' · ')
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

export default function BookCover({ path, title, animeIds, city, routeLength, publishDate, cover, variant = 'shelf' }: Props) {
  const label = animeIds?.length && animeIds[0] !== 'unknown' ? animeIds[0]! : 'SeichiGo'
  const meta = formatMeta({ city, routeLength, publishDate })
  const titleClass = variant === 'featured' ? 'text-xl' : 'text-sm'
  const coverSrc = typeof cover === 'string' && cover.trim() ? cover.trim() : null

  const coverImgSrc = coverSrc
    ? optimizeAssetCoverSrc(coverSrc, {
        width: variant === 'featured' ? 1280 : 800,
        quality: variant === 'featured' ? 78 : 72,
      })
    : null

  return (
    <div className="group relative aspect-video w-full overflow-hidden rounded-xl bg-gray-200 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="absolute inset-0 transition-transform duration-700 group-hover:scale-105" style={{ background: coverGradient(path) }} />
      {coverImgSrc ? (
        <img
          src={coverImgSrc}
          alt={title}
          width={1280}
          height={720}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading={variant === 'featured' ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={variant === 'featured' ? 'high' : 'auto'}
        />
      ) : null}
      
      {/* Gradient Overlay: only visible at bottom for text readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 transition-opacity group-hover:opacity-70" />

      <div className="relative flex h-full flex-col justify-between p-4 text-white">
        <div className="flex items-start justify-between gap-2">
          <div className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm">{label}</div>
          {city ? <div className="text-[10px] font-medium opacity-90 shadow-sm">{city}</div> : null}
        </div>

        <div className="space-y-1">
          <div className={`line-clamp-2 font-bold leading-tight drop-shadow-md ${titleClass}`}>{title}</div>
          {meta ? <div className="line-clamp-1 text-[10px] opacity-80 mix-blend-screen">{meta}</div> : null}
        </div>
      </div>
    </div>
  )
}
