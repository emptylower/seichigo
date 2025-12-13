type Props = {
  animeId: string
  city?: string
  routeLength?: string
  publishDate?: string
}

export default function PostMeta({ animeId, city, routeLength, publishDate }: Props) {
  return (
    <div className="text-sm text-gray-600">
      <span>作品：{animeId}</span>
      {city ? <span> · 城市：{city}</span> : null}
      {routeLength ? <span> · 用时：{routeLength}</span> : null}
      {publishDate ? <span> · 发布：{publishDate}</span> : null}
    </div>
  )
}

