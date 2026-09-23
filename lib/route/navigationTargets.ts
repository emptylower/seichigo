/**
 * 三家导航深链（Google / Apple / 高德）纯函数：
 * - Google：coordinates-only（WGS-84），waypoints 超 9 个分块（自 /plan navigationLinks 迁入）。
 * - Apple：WGS-84；整天只给起终点（note: 'endpointsOnly'）。
 * - 高德：路线/网页回退坐标转 GCJ-02；appUrl 按 Android（amapuri://）/ iOS（iosamap://）
 *   由 orderTargets 的 ctx 决定，url 为 ditu.amap.com/dir 网页回退。
 *
 * 兼容层：`NavigationPoint` / `buildPointNavigationUrl` / `defaultMaxNavigationWaypoints` /
 * `buildDayNavigationUrls` 与 /plan 旧 `navigationLinks.ts` 同名同签名（那边改为 re-export）。
 */

import { wgs84ToGcj02 } from '@/lib/geo/gcj02'

export type NavProvider = 'google' | 'apple' | 'amap'
export type NavTarget = {
  provider: NavProvider
  url: string
  appUrl?: string
  note?: 'endpointsOnly'
  /** Google 整天 waypoints 超 9 个时分块：url 为首段，urls 为完整分段（可依次打开） */
  urls?: string[]
  /** 高德 app 深链按平台二选一；由 orderTargets 依 ctx 解析进 appUrl（解析后移除本字段） */
  appUrls?: { android: string; ios: string }
}
export type NavStop = { lat: number; lng: number; name: string }
export type NavMode = 'transit' | 'walking' | 'driving'
export type NavOrderCtx = { isIOS: boolean; isAndroid: boolean; locale: 'zh' | 'en' | 'ja' }

const GOOGLE_DIR_BASE = 'https://www.google.com/maps/dir/'
const APPLE_MAPS_BASE = 'https://maps.apple.com/'
const AMAP_MARKER_BASE = 'https://uri.amap.com/marker'
const AMAP_WEB_DIR_BASE = 'https://ditu.amap.com/dir'

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

type Coords = { lat: number; lng: number }

function formatLatLng({ lat, lng }: Coords): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

function formatLngLat({ lng, lat }: Coords): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`
}

/** 名称里的 ASCII 逗号会破坏 vianames 逗号分隔列表，替换为全角逗号 */
function sanitizeListName(name: string): string {
  return name.replace(/,/g, '，')
}

const GOOGLE_TRAVELMODE: Record<NavMode, string> = {
  transit: 'transit',
  walking: 'walking',
  driving: 'driving',
}

const APPLE_DIRFLG: Record<NavMode, string> = {
  transit: 'r',
  walking: 'w',
  driving: 'd',
}

const AMAP_WEB_TYPE: Record<NavMode, string> = {
  transit: 'bus',
  walking: 'walk',
  driving: 'car',
}

/** 高德 URI API 的 t 参数：0 驾车（速度优先）/ 3 步行 / 4 公交 */
const AMAP_T: Record<NavMode, number> = {
  driving: 0,
  walking: 3,
  transit: 4,
}

// ---------------------------------------------------------------------------
// Google（WGS-84，coordinates-only；waypoints 分块逻辑自 /plan 迁入）
// ---------------------------------------------------------------------------

export type NavigationPoint = { lat: number; lng: number }

export function buildPointNavigationUrl(point: NavigationPoint): string {
  return `${GOOGLE_DIR_BASE}?api=1&destination=${encodeURIComponent(formatLatLng(point))}&travelmode=transit`
}

/** 桌面 9 / 移动端（pointer: coarse）3；无 window（SSR）按桌面 9。仅供调用方在 effect 里读（M7：渲染期禁用） */
export function defaultMaxNavigationWaypoints(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 9
  return window.matchMedia('(pointer: coarse)').matches ? 3 : 9
}

function buildGoogleDayUrl(
  origin: NavigationPoint,
  destination: NavigationPoint,
  waypoints: NavigationPoint[],
  mode: NavMode,
): string {
  const originParam = encodeURIComponent(formatLatLng(origin))
  const destinationParam = encodeURIComponent(formatLatLng(destination))
  const waypointsParam = waypoints.length
    ? `&waypoints=${encodeURIComponent(waypoints.map(formatLatLng).join('|'))}`
    : ''
  return `${GOOGLE_DIR_BASE}?api=1&origin=${originParam}&destination=${destinationParam}${waypointsParam}&travelmode=${GOOGLE_TRAVELMODE[mode]}`
}

/**
 * 整日导航：按 maxWaypoints 切多段，每段首尾相接（下一段 origin = 上一段
 * destination）。1 个点退化为单点导航；0 个点返回空数组。
 */
export function buildDayNavigationUrls(
  points: NavigationPoint[],
  options: { maxWaypoints?: number } = {},
): string[] {
  const maxWaypoints = Math.max(1, Math.floor(options.maxWaypoints ?? 9))
  if (points.length === 0) return []
  if (points.length === 1) return [buildPointNavigationUrl(points[0]!)]

  const segments: string[] = []
  let start = 0
  while (start < points.length - 1) {
    const end = Math.min(start + maxWaypoints + 1, points.length - 1)
    segments.push(
      buildGoogleDayUrl(points[start]!, points[end]!, points.slice(start + 1, end), 'transit'),
    )
    start = end
  }
  return segments
}

// ---------------------------------------------------------------------------
// Apple（WGS-84；整天仅起终点）
// ---------------------------------------------------------------------------

function buildAppleSingleUrl(stop: NavStop, mode: NavMode): string {
  return `${APPLE_MAPS_BASE}?daddr=${encodeURIComponent(formatLatLng(stop))}&dirflg=${APPLE_DIRFLG[mode]}`
}

function buildAppleDayUrl(stops: NavStop[], mode: NavMode): string {
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  return `${APPLE_MAPS_BASE}?saddr=${encodeURIComponent(formatLatLng(first))}&daddr=${encodeURIComponent(
    formatLatLng(last),
  )}&dirflg=${APPLE_DIRFLG[mode]}`
}

// ---------------------------------------------------------------------------
// 高德（GCJ-02；appUrl 按平台二选一，url 为网页回退）
// ---------------------------------------------------------------------------

const AMAP_VIA_MAX = 16

function amapQuery(parts: string[]): string {
  return parts.join('&')
}

function buildAmapSingleUrl(stop: NavStop): string {
  return amapQuery([
    `${AMAP_MARKER_BASE}?position=${encodeURIComponent(formatLngLat(stop))}`,
    `name=${encodeURIComponent(stop.name)}`,
    'coordinate=wgs84',
    'src=seichigo',
  ])
}

/** Android：amapuri://route/plan/；途经点 ≤16 个（vialons/vialats/vianames 逗号分隔） */
function buildAmapAndroidUrl(stops: AmapStop[], mode: NavMode): string {
  const via = stops.slice(1, -1).slice(0, AMAP_VIA_MAX)
  const dest = stops[stops.length - 1]!
  const parts = [
    'amapuri://route/plan/?sourceApplication=seichigo',
    `dlat=${dest.gcj.lat.toFixed(6)}`,
    `dlon=${dest.gcj.lng.toFixed(6)}`,
    `dname=${encodeURIComponent(sanitizeListName(dest.name))}`,
    'dev=0',
    `t=${AMAP_T[mode]}`,
  ]
  if (via.length > 0) {
    parts.push(`vialons=${via.map((s) => s.gcj.lng.toFixed(6)).join(',')}`)
    parts.push(`vialats=${via.map((s) => s.gcj.lat.toFixed(6)).join(',')}`)
    parts.push(`vianames=${encodeURIComponent(via.map((s) => sanitizeListName(s.name)).join(','))}`)
  }
  return amapQuery(parts)
}

/** iOS：iosamap://path；途经点参数同 Android */
function buildAmapIosUrl(stops: AmapStop[], mode: NavMode): string {
  const via = stops.slice(1, -1).slice(0, AMAP_VIA_MAX)
  const dest = stops[stops.length - 1]!
  const parts = [
    'iosamap://path?sourceApplication=seichigo',
    `dlat=${dest.gcj.lat.toFixed(6)}`,
    `dlon=${dest.gcj.lng.toFixed(6)}`,
    `dname=${encodeURIComponent(sanitizeListName(dest.name))}`,
    'dev=0',
    `t=${AMAP_T[mode]}`,
  ]
  if (via.length > 0) {
    parts.push(`vialons=${via.map((s) => s.gcj.lng.toFixed(6)).join(',')}`)
    parts.push(`vialats=${via.map((s) => s.gcj.lat.toFixed(6)).join(',')}`)
    parts.push(`vianames=${encodeURIComponent(via.map((s) => sanitizeListName(s.name)).join(','))}`)
  }
  return amapQuery(parts)
}

/** 网页回退：ditu.amap.com/dir，from/to/via 显式坐标（GCJ-02） */
function buildAmapWebUrl(stops: AmapStop[], mode: NavMode): string {
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  const via = stops.slice(1, -1).slice(0, AMAP_VIA_MAX)
  const parts = [
    `${AMAP_WEB_DIR_BASE}?from[lnglat]=${encodeURIComponent(formatLngLat(first.gcj))}`,
    `from[name]=${encodeURIComponent(sanitizeListName(first.name))}`,
    `to[lnglat]=${encodeURIComponent(formatLngLat(last.gcj))}`,
    `to[name]=${encodeURIComponent(sanitizeListName(last.name))}`,
  ]
  via.forEach((stop, i) => {
    parts.push(`via[${i}][lnglat]=${encodeURIComponent(formatLngLat(stop.gcj))}`)
    parts.push(`via[${i}][name]=${encodeURIComponent(sanitizeListName(stop.name))}`)
  })
  parts.push(`type=${AMAP_WEB_TYPE[mode]}`)
  return parts.join('&')
}

// ---------------------------------------------------------------------------
// 组装
// ---------------------------------------------------------------------------

type AmapStop = NavStop & { gcj: Coords }

function toAmapStops(stops: NavStop[]): AmapStop[] {
  return stops.map((stop) => ({ ...stop, gcj: wgs84ToGcj02(stop.lat, stop.lng) }))
}

/** 单点：三个 provider 的打开目标（高德 marker 页本身即 app 唤起链接，无需 appUrl） */
export function buildSingleTargets(stop: NavStop, mode: NavMode): NavTarget[] {
  return [
    {
      provider: 'google',
      url: `${GOOGLE_DIR_BASE}?api=1&destination=${encodeURIComponent(formatLatLng(stop))}&travelmode=${GOOGLE_TRAVELMODE[mode]}`,
    },
    { provider: 'apple', url: buildAppleSingleUrl(stop, mode) },
    { provider: 'amap', url: buildAmapSingleUrl(stop) },
  ]
}

/**
 * 整天：住宿首尾由调用方传入 stops。Google waypoints 超 9 个分块——url 为首段，
 * 完整分段在 urls 里（B 端可依次打开）；高德 appUrls 由 orderTargets 按 ctx 解析出 appUrl。
 */
export function buildDayTargets(
  stops: NavStop[],
  mode: NavMode,
  options: { maxWaypoints?: number } = {},
): NavTarget[] {
  if (stops.length === 0) return []
  if (stops.length === 1) return buildSingleTargets(stops[0]!, mode)

  const maxWaypoints = Math.max(1, Math.floor(options.maxWaypoints ?? 9))
  const googleUrls: string[] = []
  let start = 0
  while (start < stops.length - 1) {
    const end = Math.min(start + maxWaypoints + 1, stops.length - 1)
    googleUrls.push(
      buildGoogleDayUrl(stops[start]!, stops[end]!, stops.slice(start + 1, end), mode),
    )
    start = end
  }

  const amapStops = toAmapStops(stops)

  return [
    { provider: 'google', url: googleUrls[0]!, ...(googleUrls.length > 1 ? { urls: googleUrls } : {}) },
    { provider: 'apple', url: buildAppleDayUrl(stops, mode), note: 'endpointsOnly' },
    {
      provider: 'amap',
      url: buildAmapWebUrl(amapStops, mode),
      appUrls: {
        android: buildAmapAndroidUrl(amapStops, mode),
        ios: buildAmapIosUrl(amapStops, mode),
      },
    },
  ]
}

/** 按 ctx 排序并解析高德 appUrl：iOS → apple,google,amap；zh 非 iOS → amap,google,apple；其余 → google,apple,amap */
export function orderTargets(targets: NavTarget[], ctx: NavOrderCtx): NavTarget[] {
  const priority: NavProvider[] = ctx.isIOS
    ? ['apple', 'google', 'amap']
    : ctx.locale === 'zh'
      ? ['amap', 'google', 'apple']
      : ['google', 'apple', 'amap']

  const byProvider = new Map(targets.map((target) => [target.provider, target]))
  const ordered: NavTarget[] = []
  for (const provider of priority) {
    const target = byProvider.get(provider)
    if (!target) continue
    byProvider.delete(provider)
    ordered.push(target)
  }
  for (const rest of byProvider.values()) ordered.push(rest)

  return ordered.map((target) => {
    if (target.provider !== 'amap' || !target.appUrls) return target
    const { appUrls, ...rest } = target
    const appUrl = ctx.isIOS ? appUrls.ios : ctx.isAndroid ? appUrls.android : undefined
    return appUrl ? { ...rest, appUrl } : rest
  })
}
