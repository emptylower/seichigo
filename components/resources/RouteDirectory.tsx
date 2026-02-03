import Link from 'next/link'
import type { ResourceAnimeGroup, ResourceRoutePreview, ResourceRouteSpot } from '@/lib/resources/types'
import { buildGoogleMapsDirectionsUrls, buildGoogleStaticMapUrl } from '@/lib/route/google'
import { renderRouteMapSvg } from '@/lib/route/render'
import type { SeichiRouteSpotV1 } from '@/lib/route/schema'
import { getGoogleStaticMapApiKey, resolveSpotLatLng } from '@/lib/resources/aggregateRoutes'
import CopyLinkButton from '@/components/resources/CopyLinkButton'
import RouteCardActions from '@/components/resources/RouteCardActions'
import ResourcesDeepLinkRuntime from '@/components/resources/ResourcesDeepLinkRuntime'
import { prefixPath } from '@/components/layout/prefixPath'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

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

function routeLinkPath(route: ResourceRoutePreview, locale: SupportedLocale): string {
  return prefixPath(`/resources?route=${encodeURIComponent(route.routeKey)}#${encodeURIComponent(route.routeAnchorId)}`, locale)
}

function spotLinkPath(route: ResourceRoutePreview, s: ResourceRouteSpot, locale: SupportedLocale): string {
  return prefixPath(`/resources?route=${encodeURIComponent(route.routeKey)}#${encodeURIComponent(spotAnchorId(route, s))}`, locale)
}

function RouteCard({ route, locale }: { route: ResourceRoutePreview; locale: SupportedLocale }) {
  const primaryHref = routePrimaryHref(route)
  const map = routePreviewMap(route)
  const routeHref = routeLinkPath(route, locale)
  const articleHref = prefixPath(`/posts/${encodeURIComponent(route.articleSlug)}`, locale)

  return (
    <details className="rounded-xl border border-gray-100 bg-white shadow-sm flex flex-col h-full" data-route-key={route.routeKey}>
      <summary
        id={route.routeAnchorId}
        className="cursor-pointer list-none px-4 py-4 flex flex-col gap-4"
        style={{ scrollMarginTop: 'calc(var(--site-header-h, 60px) + 16px)' }}
      >
        <div className="flex flex-col gap-1">
          <div
            className="text-base font-semibold text-gray-900 leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden"
            title={route.routeTitle}
          >
            {route.routeTitle}
          </div>
          <div className="text-sm text-gray-500 flex flex-wrap gap-2 items-center">
            {route.city ? <span className="bg-gray-100 px-1.5 py-0.5 rounded text-xs text-gray-600 shrink-0">{route.city}</span> : null}
            <span className="text-xs text-gray-400 shrink-0">{route.spots.length} 点</span>
          </div>
        </div>

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
              {t('resources.routeCard.details', locale)}
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-50">
          <RouteCardActions articleHref={articleHref} routeHref={routeHref} primaryHref={primaryHref} locale={locale} />
        </div>
      </summary>

      <div className="px-4 pb-4">
        <div className="seichi-route__list">
          <table className="seichi-route__table">
            <thead>
              <tr>
                <th>{t('route.table.order', locale)}</th>
                <th>{t('route.table.location', locale)}</th>
                <th>{t('route.table.nearestStation', locale)}</th>
                <th>{t('route.table.photoTip', locale)}</th>
                <th>{t('route.table.timestamp', locale)}</th>
                <th>{t('route.table.navigation', locale)}</th>
              </tr>
            </thead>
            <tbody>
              {route.spots.map((s) => {
                const nav = spotNavHref(s)
                const sid = spotAnchorId(route, s)
                const spotPath = spotLinkPath(route, s, locale)
                return (
                  <tr key={sid} id={sid} style={{ scrollMarginTop: 'calc(var(--site-header-h, 60px) + 16px)' }}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span>{s.order}</span>
                        <CopyLinkButton 
                          path={spotPath} 
                          label={t('resources.actions.copy', locale)} 
                          locale={locale}
                          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50" 
                        />
                      </div>
                    </td>
                    <td>{s.label}{s.name_ja ? <span className="ml-1 text-xs text-gray-500">（{s.name_ja}）</span> : null}</td>
                    <td>{s.nearestStation_zh || '—'}</td>
                    <td>{s.photoTip || '—'}</td>
                    <td>{s.animeScene || '—'}</td>
                    <td>
                      {nav ? (
                        <a href={nav} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:text-brand-700">
                          {t('route.table.open', locale)}
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
          <div>{t('resources.routeCard.onlyFirstRouteNote', locale)}</div>
          <Link className="text-brand-600 hover:text-brand-700" href={prefixPath(`/posts/${encodeURIComponent(route.articleSlug)}`, locale)}>
            {t('resources.routeCard.goToArticle', locale)}
          </Link>
        </div>
      </div>
    </details>
  )
}

export default function RouteDirectory({ groups, locale }: { groups: ResourceAnimeGroup[]; locale: 'zh' | 'en' | 'ja' }) {
  const emptyText = locale === 'ja' ? 'ルートはまだありません。' : locale === 'en' ? 'No routes yet.' : '暂无路线资源（目前仅聚合已发布的富文本文章路线）。'
  const routeCountLabel = (n: number) => (locale === 'ja' ? `${n} ルート` : locale === 'en' ? `${n} routes` : `${n} 条路线`)
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
              <RouteCard key={r.routeKey} route={r} locale={locale} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
