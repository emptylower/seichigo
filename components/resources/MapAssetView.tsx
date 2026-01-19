import type { AggregatedSpot, LinkAsset } from '@/lib/linkAsset/types'

type Props = {
  asset: LinkAsset
  spots: AggregatedSpot[]
}

function encodeLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

function spotLabel(s: AggregatedSpot, idx: number): string {
  const nameZh = String(s.name_zh || '').trim()
  const name = String(s.name || '').trim()
  return nameZh || name || `Spot ${idx + 1}`
}

export default function MapAssetView({ spots }: Props) {
  const valid = spots
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => Boolean((s.googleMapsUrl && s.googleMapsUrl.trim()) || (typeof s.lat === 'number' && typeof s.lng === 'number')))

  const primaryHref =
    valid[0]?.s.googleMapsUrl ||
    (typeof valid[0]?.s.lat === 'number' && typeof valid[0]?.s.lng === 'number'
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(encodeLatLng(valid[0]!.s.lat!, valid[0]!.s.lng!))}`
      : null)

  return (
    <section className="space-y-6">
      <div className="card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-gray-900">地图入口</div>
          {primaryHref ? (
            <a
              href={primaryHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
            >
              在 Google Maps 打开
            </a>
          ) : null}
        </div>
        <div className="mt-2 text-sm text-gray-700">优先用点位列表做导航入口；后续可以把路线分段链接、按城市/作品过滤补齐。</div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b pb-2">
          <h2 className="text-2xl font-bold text-gray-900">点位清单</h2>
          <span className="text-sm text-gray-500">({spots.length})</span>
        </div>

        {spots.length ? (
          <ol className="space-y-3">
            {spots.map((s, idx) => {
              const label = spotLabel(s, idx)
              const href =
                (typeof s.googleMapsUrl === 'string' && s.googleMapsUrl.trim())
                  ? s.googleMapsUrl.trim()
                  : typeof s.lat === 'number' && typeof s.lng === 'number'
                    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(encodeLatLng(s.lat, s.lng))}`
                    : null

              return (
                <li key={`${s.fromArticleSlug || 'post'}-${s.fromRouteId || 'route'}-${idx}`} className="card">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-gray-900">
                        {idx + 1}. {label}
                        {s.name_ja ? <span className="ml-1 text-sm font-medium text-gray-500">（{s.name_ja}）</span> : null}
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        {[s.city, s.nearestStation_zh].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm text-brand-600 hover:text-brand-700">
                        打开
                      </a>
                    ) : null}
                  </div>
                  {s.photoTip ? <div className="mt-2 text-sm text-gray-700">机位：{s.photoTip}</div> : null}
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-12 text-center">
            <p className="text-gray-500">暂无可聚合的点位（目前仅从已发布的富文本文章 contentJson 聚合）。</p>
          </div>
        )}
      </div>
    </section>
  )
}
