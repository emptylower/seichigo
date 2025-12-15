type Props = {
  animeIds: string[]
  city?: string
  routeLength?: string
  publishDate?: string
}

export default function PostMeta({ animeIds, city, routeLength, publishDate }: Props) {
  const animeLabel = animeIds.length ? animeIds.join('、') : 'unknown'
  return (
    <div className="text-sm text-gray-600">
      <span>作品：{animeLabel}</span>
      {city ? <span> · 城市：{city}</span> : null}
      {routeLength ? <span> · 用时：{routeLength}</span> : null}
      {publishDate ? <span> · 发布：{publishDate}</span> : null}
    </div>
  )
}
