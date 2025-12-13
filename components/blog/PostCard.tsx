import Link from 'next/link'

type Props = {
  title: string
  slug: string
  animeId: string
  city?: string
  publishDate?: string
}

export default function PostCard({ title, slug, animeId, city, publishDate }: Props) {
  return (
    <article className="card">
      <h3 className="text-lg font-semibold"><Link href={`/posts/${slug}`}>{title}</Link></h3>
      <p className="mt-1 text-sm text-gray-600">作品：{animeId}{city ? ` · ${city}` : ''}</p>
      {publishDate ? <p className="mt-1 text-xs text-gray-400">发布日期：{publishDate}</p> : null}
    </article>
  )
}

