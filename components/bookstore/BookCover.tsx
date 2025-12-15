type Props = {
  path: string
  title: string
  animeIds: string[]
  city?: string | null
  routeLength?: string | null
  publishDate?: string | null
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

export default function BookCover({ path, title, animeIds, city, routeLength, publishDate, variant = 'shelf' }: Props) {
  const label = animeIds?.length && animeIds[0] !== 'unknown' ? animeIds[0]! : 'SeichiGo'
  const meta = formatMeta({ city, routeLength, publishDate })
  const titleClass = variant === 'featured' ? 'text-xl' : 'text-sm'

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-black/5 shadow-sm">
      <div className="absolute inset-0" style={{ background: coverGradient(path) }} />
      <div className="absolute inset-y-0 right-0 w-6 bg-white/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-black/0" />

      <div className="relative flex h-full flex-col justify-between p-3 text-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 text-[10px] font-semibold tracking-widest opacity-90">{label}</div>
          {city ? <div className="shrink-0 text-[10px] opacity-85">{city}</div> : null}
        </div>

        <div className="space-y-1">
          <div className={`line-clamp-3 font-semibold leading-snug drop-shadow-sm ${titleClass}`}>{title}</div>
          {meta ? <div className="text-[10px] opacity-85">{meta}</div> : null}
        </div>
      </div>
    </div>
  )
}
