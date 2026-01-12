import type { SeichiRouteEmbedV1, SeichiRouteSpotV1 } from './schema'

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

export function renderRouteMapSvg(spots: SeichiRouteSpotV1[]): string {
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
    `<svg class="seichi-route__svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="路线总览图">` +
    `<path class="seichi-route__path" d="${escapeAttr(d)}" fill="none" stroke="#f472b6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>` +
    circles +
    `</svg>`
  )
}

function renderRouteTable(spots: SeichiRouteSpotV1[]): string {
  const header =
    '<thead><tr>' +
    '<th>顺序</th>' +
    '<th>地点</th>' +
    '<th>最近站</th>' +
    '<th>机位建议</th>' +
    '<th>时间戳</th>' +
    '<th>导航</th>' +
    '</tr></thead>'

  const rows = spots
    .map((spot, idx) => {
      const order = idx + 1
      const name = escapeHtml(spotLabel(spot, order))
      const station = escapeHtml(String(spot.nearestStation_zh || ''))
      const photoTip = escapeHtml(String(spot.photoTip || ''))
      const scene = escapeHtml(String(spot.animeScene || ''))
      const url = sanitizeHttpUrl(spot.googleMapsUrl)
      const link = url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">打开</a>` : ''

      return `<tr><td>${order}</td><td>${name}</td><td>${station}</td><td>${photoTip}</td><td>${scene}</td><td>${link}</td></tr>`
    })
    .join('')

  return `<table class="seichi-route__table">${header}<tbody>${rows}</tbody></table>`
}

export function renderSeichiRouteEmbedHtml(route: SeichiRouteEmbedV1, options?: { id?: string }): string {
  const idAttr = options?.id ? ` data-id="${escapeAttr(options.id)}"` : ''
  const svg = renderRouteMapSvg(route.spots)
  const table = renderRouteTable(route.spots)
  return (
    `<section class="seichi-route"${idAttr}>` +
    `<div class="seichi-route__map">${svg}</div>` +
    `<div class="seichi-route__list">${table}</div>` +
    `</section>`
  )
}
