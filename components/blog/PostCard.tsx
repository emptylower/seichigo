import Link from 'next/link'

type Props = {
  title: string
  path: string
  animeIds: string[]
  city?: string
  publishDate?: string
}

export default function PostCard({ title, path, animeIds, city, publishDate }: Props) {
  const animeLabel = animeIds.length ? animeIds.join('、') : 'unknown'
  return (
    <article className="card">
      <h3 className="text-lg font-semibold">
        <Link href={path}>{title}</Link>
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        作品：{animeLabel}
        {city ? ` · ${city}` : ''}
      </p>
      {publishDate ? <p className="mt-1 text-xs text-gray-400">发布日期：{publishDate}</p> : null}
    </article>
  )
}
