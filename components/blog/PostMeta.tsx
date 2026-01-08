import Link from 'next/link'

type AnimeLink = {
  id: string
  label: string
}

type Props = {
  anime: AnimeLink[]
  city?: string
  routeLength?: string
  publishDate?: string
}

export default function PostMeta({ anime, city, routeLength, publishDate }: Props) {
  return (
    <div className="text-sm text-gray-600">
      <span>
        作品：
        {anime.length ? (
          anime.map((a, idx) => (
            <span key={a.id}>
              {idx === 0 ? '' : '、'}
              <Link href={`/anime/${encodeURIComponent(a.id)}`} className="hover:underline">
                {a.label}
              </Link>
            </span>
          ))
        ) : (
          'unknown'
        )}
      </span>
      {city ? <span> · 城市：{city}</span> : null}
      {routeLength ? <span> · 用时：{routeLength}</span> : null}
      {publishDate ? <span> · 发布：{publishDate}</span> : null}
    </div>
  )
}
