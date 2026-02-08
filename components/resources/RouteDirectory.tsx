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

type UpcomingAnimeItem = {
  id: string
  name: string
  cover: string | null
}

function hash32(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0
  return h
}

function toIdSegment(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return 'item'
  const lowered = raw.toLowerCase()
  const normalized = lowered.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || `x${hash32(raw).toString(36)}`
}

function animeSectionIdFor(input: string): string {
  return `anime-${toIdSegment(input)}`
}

function directoryCopy(locale: SupportedLocale) {
  if (locale === 'en') {
    return {
      quickJump: 'Quick Jump',
      mapCollection: 'SeichiGo map collection',
      soonTitle: 'Upcoming map collections',
      soonDescription: 'These titles already exist in SeichiGo and their route maps will appear as more articles are published.',
      soonCardHint: 'Route map will be published with upcoming articles.',
      soonBadge: 'In production',
      soonLink: 'Coming soon',
      emptyTitle: 'No route maps yet',
      emptyDescription: 'Publish route embeds in posts first. This directory will auto-generate grouped map entries.',
      routeGridHint: 'Grouped by anime and synced with published posts',
    }
  }
  if (locale === 'ja') {
    return {
      quickJump: 'クイックジャンプ',
      mapCollection: 'SeichiGo マップコレクション',
      soonTitle: '公開予定の作品マップ',
      soonDescription: 'SeichiGoに登録済みの作品です。記事の公開にあわせてルートマップが自動で追加されます。',
      soonCardHint: '記事公開後にルートマップが追加されます。',
      soonBadge: '制作中',
      soonLink: '近日公開',
      emptyTitle: 'ルートマップはまだありません',
      emptyDescription: '記事にルート埋め込みを公開すると、このページに作品別で自動集約されます。',
      routeGridHint: '作品ごとに整理され、公開記事の更新に追従します',
    }
  }
  return {
    quickJump: '快速跳转',
    mapCollection: 'SeichiGo 地图集',
    soonTitle: '即将上线作品地图',
    soonDescription: '这些作品已在 SeichiGo 收录，随着相关文章发布会自动出现对应的总路线图。',
    soonCardHint: '相关文章发布后将自动生成地图入口。',
    soonBadge: '地图制作中',
    soonLink: '即将上线',
    emptyTitle: '暂无可展示路线',
    emptyDescription: '先在文章中发布路线图嵌入，这里会自动按作品生成可引用地图目录。',
    routeGridHint: '按作品分组展示，随已发布文章自动更新',
  }
}

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
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_12px_35px_-24px_rgba(15,23,42,0.7)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_45px_-26px_rgba(15,23,42,0.72)]">
      <details data-route-key={route.routeKey}>
        <summary
          id={route.routeAnchorId}
          className="cursor-pointer list-none px-4 py-4 flex flex-col gap-4 md:px-5"
          style={{ scrollMarginTop: 'calc(var(--site-header-h, 60px) + 16px)' }}
        >
          <div className="flex flex-col gap-1">
            <div
              className="text-base font-semibold leading-snug text-slate-900 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden"
              title={route.routeTitle}
            >
              {route.routeTitle}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              {route.city ? <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{route.city}</span> : null}
              <span className="shrink-0 text-xs text-slate-400">{route.spots.length} 点</span>
            </div>
          </div>

          <div className="seichi-route__map">
            <div className="seichi-route__map-card">
              {map.kind === 'img' ? (
                <img className="seichi-route__map-img" src={map.url} alt="路线地图预览" loading="lazy" decoding="async" />
              ) : (
                <div className="flex items-center justify-center p-6" dangerouslySetInnerHTML={{ __html: map.svg }} />
              )}
              <div className="seichi-route__map-cta" aria-hidden="true">
                {t('resources.routeCard.details', locale)}
              </div>
            </div>
          </div>
        </summary>

        <div className="px-4 pb-4 md:px-5">
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
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
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

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <div>{t('resources.routeCard.onlyFirstRouteNote', locale)}</div>
            <Link className="text-brand-600 hover:text-brand-700" href={prefixPath(`/posts/${encodeURIComponent(route.articleSlug)}`, locale)}>
              {t('resources.routeCard.goToArticle', locale)}
            </Link>
          </div>
        </div>
      </details>

      <div className="border-t border-slate-100 px-4 py-3 md:px-5">
        <RouteCardActions articleHref={articleHref} routeHref={routeHref} primaryHref={primaryHref} locale={locale} />
      </div>
    </article>
  )
}

export default function RouteDirectory({
  groups,
  locale,
  upcomingAnime = [],
}: {
  groups: ResourceAnimeGroup[]
  locale: 'zh' | 'en' | 'ja'
  upcomingAnime?: UpcomingAnimeItem[]
}) {
  const copy = directoryCopy(locale)
  const routeCountLabel = (n: number) => (locale === 'ja' ? `${n} ルート` : locale === 'en' ? `${n} routes` : `${n} 条路线`)
  const groupsWithSectionId = groups.map((g) => ({ ...g, sectionId: animeSectionIdFor(g.animeId) }))

  return (
    <div className="space-y-10">
      <ResourcesDeepLinkRuntime />

      {groupsWithSectionId.length ? (
        <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-pink-50/30 p-4 md:p-5">
          <div className="text-xs font-semibold tracking-[0.1em] text-slate-500">{copy.quickJump}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {groupsWithSectionId.map((g) => (
              <a
                key={g.animeId}
                href={`#${g.sectionId}`}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
              >
                <span className="max-w-[170px] truncate">{g.animeName}</span>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{routeCountLabel(g.routeCount)}</span>
              </a>
            ))}
            {upcomingAnime.length ? (
              <a
                href="#coming-soon"
                className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
              >
                <span>{copy.soonLink}</span>
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] text-brand-700">{upcomingAnime.length}</span>
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {!groupsWithSectionId.length ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center">
          <h2 className="text-lg font-semibold text-slate-900">{copy.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600">{copy.emptyDescription}</p>
        </section>
      ) : null}

      {groupsWithSectionId.map((g) => (
        <section key={g.animeId} id={g.sectionId} className="space-y-4">
          <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-pink-50/20 p-4 md:p-5">
            <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_center,rgba(244,114,182,0.18),transparent_70%)] md:block" />
            <div className="relative flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-100">
                  {g.cover ? <img src={g.cover} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" /> : null}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold text-slate-900">{g.animeName}</div>
                  <div className="text-xs text-slate-500">
                    {routeCountLabel(g.routeCount)} · {copy.routeGridHint}
                  </div>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                {copy.mapCollection}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
            {g.routes.map((r) => (
              <RouteCard key={r.routeKey} route={r} locale={locale} />
            ))}
          </div>
        </section>
      ))}

      {upcomingAnime.length ? (
        <section id="coming-soon" className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 md:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{copy.soonTitle}</h3>
                <p className="mt-1 text-sm text-slate-600">{copy.soonDescription}</p>
              </div>
              <span className="hidden rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 md:inline-flex">
                {copy.soonBadge}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingAnime.map((a) => (
              <article key={a.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_-24px_rgba(15,23,42,0.8)]">
                <div className="relative aspect-[16/9] overflow-hidden">
                  {a.cover ? (
                    <img src={a.cover} alt="" className="h-full w-full object-cover opacity-80 transition duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
                  ) : (
                    <div className="h-full w-full bg-[linear-gradient(130deg,#f8fafc,#e2e8f0,#fce7f3)]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/55 via-slate-900/10 to-transparent" />
                  <span className="absolute left-3 top-3 rounded-full border border-white/35 bg-black/25 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                    {copy.soonBadge}
                  </span>
                </div>
                <div className="p-4">
                  <h4 className="line-clamp-1 text-base font-semibold text-slate-900">{a.name}</h4>
                  <p className="mt-1 text-sm text-slate-500">{copy.soonCardHint}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
