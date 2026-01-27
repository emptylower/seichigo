import Link from 'next/link'
import type { ResourceAnimeGroup, ResourceRoutePreview, ResourceRouteSpot } from '@/lib/resources/types'
import { buildGoogleMapsDirectionsUrls, buildGoogleStaticMapUrl } from '@/lib/route/google'
import { renderRouteMapSvg } from '@/lib/route/render'
import type { SeichiRouteSpotV1 } from '@/lib/route/schema'
import { getGoogleStaticMapApiKey, resolveSpotLatLng } from '@/lib/resources/aggregateRoutes'
import CopyLinkButton from '@/components/resources/CopyLinkButton'
import ResourcesDeepLinkRuntime from '@/components/resources/ResourcesDeepLinkRuntime'

function encodeLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

function spotNavHref(s: ResourceRouteSpot): string | null {
  if (typeof s.googleMapsUrl === 'string' && s.googleMapsUrl.trim()) return s.googleMapsUrl.trim()
  if (typeof s.lat === 'number' && typeof s.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(encodeLatLng(s.lat, s.lng))}`
  }
  return null
}

function routePrimaryHref(route: ResourceRoutePreview): string | null {
  const points = route.previewSpots.map(resolveSpotLatLng).filter(Boolean) as { lat: number; lng: number }[]
  if (points.length >= 2) {
    const urls = buildGoogleMapsDirectionsUrls(points)
    if (urls[0]) return urls[0]
  }
  const first = route.previewSpots[0] || route.spots[0]
  return first ? spotNavHref(first) : null
}

function routePreviewMap(route: ResourceRoutePreview): { kind: 'img'; url: string } | { kind: 'svg'; svg: string } {
  const apiKey = getGoogleStaticMapApiKey()
  const points = route.previewSpots.map(resolveSpotLatLng).filter(Boolean) as { lat: number; lng: number }[]
  if (apiKey && points.length >= 1) {
    const url = buildGoogleStaticMapUrl(points, { apiKey, width: 640, height: 360, scale: 2 })
    if (url) return { kind: 'img', url }
  }
  const svgSpots: SeichiRouteSpotV1[] = route.previewSpots.map((s) => ({
    name_zh: s.name_zh,
    name: s.name,
    name_ja: s.name_ja,
    nearestStation_zh: s.nearestStation_zh,
    nearestStation_ja: s.nearestStation_ja,
    animeScene: s.animeScene,
    googleMapsUrl: s.googleMapsUrl,
    lat: s.lat,
    lng: s.lng,
    photoTip: s.photoTip,
    note: s.note,
  }))
  return { kind: 'svg', svg: renderRouteMapSvg(svgSpots) }
}

function spotAnchorId(route: ResourceRoutePreview, s: ResourceRouteSpot): string {
  return `spot-${route.routeAnchorId}-${s.order}-${s.spotKey}`
}

function routeLinkPath(route: ResourceRoutePreview): string {
  return `/resources?route=${encodeURIComponent(route.routeKey)}#${encodeURIComponent(route.routeAnchorId)}`
}

function spotLinkPath(route: ResourceRoutePreview, s: ResourceRouteSpot): string {
  return `/resources?route=${encodeURIComponent(route.routeKey)}#${encodeURIComponent(spotAnchorId(route, s))}`
}

function RouteCard({ route }: { route: ResourceRoutePreview }) {
  const primaryHref = routePrimaryHref(route)
  const map = routePreviewMap(route)
  const routeHref = routeLinkPath(route)

  return (
    <details className="rounded-xl border border-gray-100 bg-white shadow-sm" data-route-key={route.routeKey}>
      <summary
        id={route.routeAnchorId}
        className="cursor-pointer list-none px-4 py-4"
        style={{ scrollMarginTop: 'calc(var(--site-header-h, 60px) + 16px)' }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">{route.routeTitle}</div>
            <div className="mt-1 text-xs text-gray-500">
              <Link className="hover:text-brand-700" href={`/posts/${encodeURIComponent(route.articleSlug)}`}>
                {route.articleTitle}
              </Link>
              {route.city ? <span className="ml-2">{route.city}</span> : null}
              <span className="ml-2">{route.spots.length} 点</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CopyLinkButton path={routeHref} label="引用路线" />
            {primaryHref ? (
              <a
                href={primaryHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md bg-brand-500 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-brand-600"
              >
                打开地图
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          <div className="seichi-route__map">
            <div className="seichi-route__map-card">
              {map.kind === 'img' ? (
                <img className="seichi-route__map-img" src={map.url} alt="路线地图预览" loading="lazy" decoding="async" />
              ) : (
                <div className="flex items-center justify-center p-6" dangerouslySetInnerHTML={{ __html: map.svg }} />
              )}
              {primaryHref ? (
                <a className="seichi-route__map-primary" href={primaryHref} target="_blank" rel="noopener noreferrer" aria-label="在 Google 地图打开" />
              ) : null}
              <div className="seichi-route__map-cta" aria-hidden="true">
                详情
              </div>
            </div>
          </div>
        </div>
      </summary>

      <div className="px-4 pb-4">
        <div className="seichi-route__list">
          <table className="seichi-route__table">
            <thead>
              <tr>
                <th>顺序</th>
                <th>地点</th>
                <th>最近站</th>
                <th>机位建议</th>
                <th>时间戳</th>
                <th>导航</th>
              </tr>
            </thead>
            <tbody>
              {route.spots.map((s) => {
                const nav = spotNavHref(s)
                const sid = spotAnchorId(route, s)
                return (
                  <tr key={sid} id={sid} style={{ scrollMarginTop: 'calc(var(--site-header-h, 60px) + 16px)' }}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span>{s.order}</span>
                        <CopyLinkButton path={spotLinkPath(route, s)} label="引用" className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50" />
                      </div>
                    </td>
                    <td>{s.label}{s.name_ja ? <span className="ml-1 text-xs text-gray-500">（{s.name_ja}）</span> : null}</td>
                    <td>{s.nearestStation_zh || '—'}</td>
                    <td>{s.photoTip || '—'}</td>
                    <td>{s.animeScene || '—'}</td>
                    <td>
                      {nav ? (
                        <a href={nav} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:text-brand-700">
                          打开
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <div>默认仅展示每篇文章的第一条路线（总路线）。</div>
          <Link className="text-brand-600 hover:text-brand-700" href={`/posts/${encodeURIComponent(route.articleSlug)}`}>
            去文章正文
          </Link>
        </div>
      </div>
    </details>
  )
}

export default function RouteDirectory({ groups, locale }: { groups: ResourceAnimeGroup[]; locale: 'zh' | 'en' }) {
  const emptyText = locale === 'en' ? 'No routes yet.' : '暂无路线资源（目前仅聚合已发布的富文本文章路线）。'
  const routeCountLabel = (n: number) => (locale === 'en' ? `${n} routes` : `${n} 条路线`)
  return (
    <div className="space-y-10">
      <ResourcesDeepLinkRuntime />
      {!groups.length ? <div className="mt-8 text-gray-500">{emptyText}</div> : null}

      {groups.map((g) => (
        <section key={g.animeId} className="space-y-4">
          <div className="flex items-center justify-between gap-4 border-b border-gray-100 pb-2">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-100">
                {g.cover ? <img src={g.cover} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" /> : null}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-bold text-gray-900">{g.animeName}</div>
                <div className="text-xs text-gray-500">{routeCountLabel(g.routeCount)}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 items-start md:grid-cols-2 lg:grid-cols-3">
            {g.routes.map((r) => (
              <RouteCard key={r.routeKey} route={r} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
