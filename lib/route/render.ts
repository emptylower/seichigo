import type { SeichiRouteEmbedV1, SeichiRouteSpotV1 } from './schema'
import { buildGoogleMapsDirectionsUrls, buildGoogleStaticMapUrl, extractLatLngFromGoogleMapsUrl, type LatLng } from './google'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttr(input: string): string {
  return escapeHtml(input)
}

function sanitizeHttpUrl(input: string | undefined): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (raw.startsWith('//')) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function spotLabel(spot: SeichiRouteSpotV1, order: number): string {
  const zh = typeof spot.name_zh === 'string' ? spot.name_zh.trim() : ''
  const name = typeof spot.name === 'string' ? spot.name.trim() : ''
  return zh || name || `Spot ${order}`
}

export function renderRouteMapSvg(spots: SeichiRouteSpotV1[], locale: SupportedLocale = 'zh'): string {
  const n = Math.max(1, spots.length)
  const width = 240
  const paddingX = 28
  const leftX = paddingX
  const rightX = width - paddingX
  const stepY = 84
  const r = 14
  const top = 18 + r
  const height = top + (n - 1) * stepY + r + 18

  const points = Array.from({ length: n }, (_, i) => {
    const x = i % 2 === 0 ? leftX : rightX
    const y = top + i * stepY
    return { x, y }
  })

  const paths: string[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const midY = (a.y + b.y) / 2
    paths.push(`M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`)
  }

  const circles = points
    .map((p, i) => {
      const idx = i + 1
      return (
        `<g class="seichi-route__node" data-order="${idx}">` +
        `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#ffffff" stroke="#f472b6" stroke-width="3"></circle>` +
        `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" fill="#111827" font-size="12" font-weight="600" font-family="system-ui, -apple-system, Segoe UI, Roboto">${idx}</text>` +
        `</g>`
      )
    })
    .join('')

  const d = paths.join(' ')
  return (
    `<svg class="seichi-route__svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeAttr(t('route.embed.overviewAlt', locale))}">` +
    `<path class="seichi-route__path" d="${escapeAttr(d)}" fill="none" stroke="#f472b6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>` +
    circles +
    `</svg>`
  )
}

function getGoogleStaticMapApiKey(): string | null {
  const key =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_STATIC_API_KEY ||
    ''
  const trimmed = String(key || '').trim()
  return trimmed ? trimmed : null
}

function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
}

function resolveSpotLatLng(spot: SeichiRouteSpotV1): LatLng | null {
  if (typeof spot.lat === 'number' && typeof spot.lng === 'number') {
    return { lat: spot.lat, lng: spot.lng }
  }
  const fromUrl = extractLatLngFromGoogleMapsUrl(String(spot.googleMapsUrl || ''))
  return fromUrl
}

function renderRouteMapCard(spots: SeichiRouteSpotV1[], locale: SupportedLocale = 'zh'): string {
  const points = spots.map(resolveSpotLatLng)
  const resolved = points.filter((p): p is LatLng => Boolean(p))
  const apiKey = getGoogleStaticMapApiKey()

  if (!apiKey || resolved.length < 1) {
    return renderRouteMapSvg(spots, locale)
  }

  const staticMapUrl = buildGoogleStaticMapUrl(resolved, { apiKey, width: 640, height: 360, scale: 2 })
  if (!staticMapUrl) return renderRouteMapSvg(spots, locale)

  const allHaveCoords = points.length === resolved.length
  const routeUrls = allHaveCoords && resolved.length >= 2 ? buildGoogleMapsDirectionsUrls(resolved) : []

  const primaryHref =
    routeUrls[0] ||
    sanitizeHttpUrl(spots.find((s) => typeof s.googleMapsUrl === 'string' && s.googleMapsUrl.trim())?.googleMapsUrl) ||
    (resolved[0] ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatLatLng(resolved[0]))}` : null)

  const img =
    `<img class="seichi-route__map-img" src="${escapeAttr(staticMapUrl)}" alt="${escapeAttr(t('route.embed.mapPreviewAlt', locale))}" width="640" height="360" loading="eager" decoding="async">`

  const primaryLink = primaryHref
    ? `<a class="seichi-route__map-primary" href="${escapeAttr(primaryHref)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(t('route.embed.openInMaps', locale))}"></a>`
    : ''

  const segments =
    routeUrls.length > 1
      ? `<div class="seichi-route__map-segments" aria-label="${escapeAttr(t('route.embed.segmentsLabel', locale))}">` +
        routeUrls
          .map((u, i) => {
            const label = `${t('route.embed.routeSegment', locale)} ${i + 1}/${routeUrls.length}`
            return `<a class="seichi-route__map-segment" href="${escapeAttr(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
          })
          .join('') +
        `</div>`
      : ''

  return (
    `<div class="seichi-route__map-card">` +
    img +
    primaryLink +
    `<div class="seichi-route__map-cta" aria-hidden="true">${escapeHtml(t('route.embed.openInMaps', locale))}</div>` +
    segments +
    `</div>`
  )
}

/**
 * 表格列描述（§0.7）：`order`/`location` 恒显示，其余列「所有 spot 都为空」时
 * 整列不渲染（窄屏卡片里不留空行，桌面也不留空白列）。`cell` 返回已转义的 HTML。
 */
type RouteTableColumn = {
  key: 'order' | 'location' | 'nearestStation' | 'photoTip' | 'timestamp' | 'navigation'
  label: string
  cell: (spot: SeichiRouteSpotV1, order: number) => string
  /** 恒显示的列不传；其余列由 spots 是否有内容决定 */
  visible?: (spots: SeichiRouteSpotV1[]) => boolean
}

function anyNonEmpty(spots: SeichiRouteSpotV1[], read: (spot: SeichiRouteSpotV1) => unknown): boolean {
  return spots.some((spot) => String(read(spot) || '').trim().length > 0)
}

function routeTableColumns(locale: SupportedLocale): RouteTableColumn[] {
  return [
    { key: 'order', label: t('route.table.order', locale), cell: (_spot, order) => String(order) },
    { key: 'location', label: t('route.table.location', locale), cell: (spot, order) => escapeHtml(spotLabel(spot, order)) },
    {
      key: 'nearestStation',
      label: t('route.table.nearestStation', locale),
      cell: (spot) => escapeHtml(String(spot.nearestStation_zh || '').trim()),
      visible: (spots) => anyNonEmpty(spots, (spot) => spot.nearestStation_zh),
    },
    {
      key: 'photoTip',
      label: t('route.table.photoTip', locale),
      cell: (spot) => escapeHtml(String(spot.photoTip || '').trim()),
      visible: (spots) => anyNonEmpty(spots, (spot) => spot.photoTip),
    },
    {
      key: 'timestamp',
      label: t('route.table.timestamp', locale),
      cell: (spot) => escapeHtml(String(spot.animeScene || '').trim()),
      visible: (spots) => anyNonEmpty(spots, (spot) => spot.animeScene),
    },
    {
      key: 'navigation',
      label: t('route.table.navigation', locale),
      cell: (spot) => {
        const url = sanitizeHttpUrl(spot.googleMapsUrl)
        return url
          ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('route.table.open', locale))}</a>`
          : ''
      },
      visible: (spots) => spots.some((spot) => sanitizeHttpUrl(spot.googleMapsUrl) != null),
    },
  ]
}

function renderRouteTable(spots: SeichiRouteSpotV1[], locale: SupportedLocale = 'zh'): string {
  const columns = routeTableColumns(locale).filter((column) => (column.visible ? column.visible(spots) : true))

  const header =
    '<thead><tr>' +
    columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('') +
    '</tr></thead>'

  const rows = spots
    .map((spot, idx) => {
      const order = idx + 1
      // data-col 供样式挂钩，data-label 供窄屏卡片的 ::before 显示列名
      const cells = columns
        .map(
          (column) =>
            `<td data-col="${column.key}" data-label="${escapeAttr(column.label)}">${column.cell(spot, order)}</td>`,
        )
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  return `<table class="seichi-route__table">${header}<tbody>${rows}</tbody></table>`
}

export function renderSeichiRouteEmbedHtml(route: SeichiRouteEmbedV1, options?: { id?: string; locale?: SupportedLocale }): string {
  const locale = options?.locale ?? 'zh'
  const idAttr = options?.id ? ` data-id="${escapeAttr(options.id)}"` : ''
  const map = renderRouteMapCard(route.spots, locale)
  const table = renderRouteTable(route.spots, locale)
  return (
    `<section class="seichi-route"${idAttr}>` +
    `<div class="seichi-route__map">${map}</div>` +
    `<div class="seichi-route__list">${table}</div>` +
    `</section>`
  )
}
