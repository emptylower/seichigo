import type { HomeMapWorld, HomeMapWorldBounds, HomeMapWorldLabel } from './types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * §1 契约的像素换算（前端与生成脚本共用同一公式）：
 * 等距圆柱投影下经度线性映射为 0..100%（跨 180° 用模 360 回绕），纬度线性映射 latTop→0%、latBottom→100%。
 */
export function projectMapWorld(
  bounds: HomeMapWorldBounds,
  lng: number,
  lat: number
): { xPct: number; yPct: number } {
  const lngStart = Number(bounds.lngStart)
  const lngSpan = Number(bounds.lngSpan)
  const latTop = Number(bounds.latTop)
  const latBottom = Number(bounds.latBottom)
  const offset = ((lng - lngStart) % 360 + 360) % 360
  return {
    xPct: (offset / lngSpan) * 100,
    yPct: ((latTop - lat) / (latTop - latBottom)) * 100,
  }
}

/** 经度是否落在图片覆盖范围内（跨 180° 回绕判定；边界值算在内） */
export function isLngInWorldBounds(lng: number, bounds: HomeMapWorldBounds): boolean {
  const { xPct } = projectMapWorld(bounds, lng, bounds.latTop)
  return xPct >= 0 && xPct <= 100
}

/** 纬度是否落在图片覆盖范围内（边界值算在内） */
export function isLatInWorldBounds(lat: number, bounds: HomeMapWorldBounds): boolean {
  const { yPct } = projectMapWorld(bounds, bounds.lngStart, lat)
  return yPct >= 0 && yPct <= 100
}

function parseBounds(raw: unknown): HomeMapWorldBounds | null {
  if (!isPlainObject(raw)) return null
  const lngStart = Number(raw.lngStart)
  const lngSpan = Number(raw.lngSpan)
  const latTop = Number(raw.latTop)
  const latBottom = Number(raw.latBottom)
  if (![lngStart, lngSpan, latTop, latBottom].every(Number.isFinite)) return null
  if (lngSpan <= 0 || latTop <= latBottom) return null
  return { lngStart, lngSpan, latTop, latBottom }
}

function parseImage(raw: unknown): HomeMapWorld['image'] | null {
  if (!isPlainObject(raw)) return null
  const src = typeof raw.src === 'string' ? raw.src.trim() : ''
  const src2x = typeof raw.src2x === 'string' ? raw.src2x.trim() : ''
  const width = Number(raw.width)
  const height = Number(raw.height)
  const attribution = typeof raw.attribution === 'string' ? raw.attribution.trim() : ''
  if (!src || !src2x || !attribution) return null
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return null
  const bounds = parseBounds(raw.bounds)
  if (!bounds) return null
  return { src, src2x, width, height, bounds, attribution }
}

function parseLabels(rawLabels: unknown): HomeMapWorldLabel[] | null {
  if (!Array.isArray(rawLabels) || rawLabels.length === 0) return null

  const labels: HomeMapWorldLabel[] = []
  for (const label of rawLabels) {
    if (!isPlainObject(label) || !isPlainObject(label.name)) return null
    const key = typeof label.key === 'string' ? label.key.trim() : ''
    const zh = typeof label.name.zh === 'string' ? label.name.zh.trim() : ''
    if (!key || !zh) return null
    const fallback = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : zh
    const lng = Number(label.lng)
    const lat = Number(label.lat)
    const count = Number(label.count)
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(count) || count <= 0) {
      return null
    }
    if (label.primary !== undefined && typeof label.primary !== 'boolean') return null
    labels.push({
      key,
      name: { zh, en: fallback(label.name.en), ja: fallback(label.name.ja) },
      count,
      lng,
      lat,
      ...(label.primary === true ? { primary: true } : {}),
    })
  }
  return labels
}

/** 读取 content/generated/home-map-world.json 时的形状校验；不合法返回 null（可选产物，不抛错） */
export function parseHomeMapWorld(raw: unknown): HomeMapWorld | null {
  if (!isPlainObject(raw)) return null
  const generatedAt = typeof raw.generatedAt === 'string' ? raw.generatedAt.trim() : ''
  if (!generatedAt) return null
  if (!Number.isFinite(Number(raw.totalPoints)) || Number(raw.totalPoints) < 0) return null
  const image = parseImage(raw.image)
  if (!image) return null
  const labels = parseLabels(raw.labels)
  if (!labels) return null
  return { generatedAt, totalPoints: Number(raw.totalPoints), image, labels }
}
