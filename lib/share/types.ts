import japanOutlineJson from '@/lib/share/data/japan-outline.json'
import type { SupportedLocale } from '@/lib/i18n/types'

/** 分享卡片版式：竖版给小红书/B 站/微信/Instagram，横版给 X/Reddit/LINE 的链接预览 */
export type ShareCardLayout = 'portrait' | 'landscape'

/** 卡片布局：默认只有动画截图；用户加了实拍才切 compare */
export type ShareCardVariant = 'default' | 'compare'

/** 短链渠道参数 `?c=` 的取值 */
export type ShareChannel = 'x' | 'rd' | 'ln' | 'xhs' | 'wx' | 'sys' | 'copy' | 'save'

export const SHARE_CHANNELS: readonly ShareChannel[] = [
  'x',
  'rd',
  'ln',
  'xhs',
  'wx',
  'sys',
  'copy',
  'save',
] as const

/** `c` → `utm_medium`：/s/[code] 跳转到地图深链时写进 URL */
export const SHARE_CHANNEL_UTM_MEDIUM: Readonly<Record<ShareChannel, string>> = {
  x: 'twitter',
  rd: 'reddit',
  ln: 'line',
  xhs: 'xiaohongshu',
  wx: 'wechat',
  sys: 'native',
  copy: 'copy',
  save: 'image',
}

export const SHARE_CARD_SIZES: Readonly<Record<ShareCardLayout, { width: number; height: number }>> = {
  portrait: { width: 1080, height: 1440 },
  landscape: { width: 1200, height: 630 },
}

/** 卡片体积上限 1.5 MB；客户端超出时降质量重试一次 */
export const SHARE_CARD_MAX_BYTES = 1_500_000
/** 实拍上限 5 MB；HEIC/WebP 由客户端转 JPEG 后再传 */
export const SHARE_PHOTO_MAX_BYTES = 5_000_000

export type CreateShareLinkRequest = {
  pointId: string
  bangumiId: number
  locale: SupportedLocale
  layout: ShareCardLayout
}

export type CreateShareLinkResponse = {
  code: string
  /** 绝对短链，形如 https://seichigo.com/s/AbC12xYz */
  url: string
}

export type ShareUploadResponse = {
  ok: true
  /** 卡片公开读取地址 /api/share/img/<code> */
  imageUrl: string
  /** 写进 UserPointState.photoUrl 的地址；没传 photo 时为 null */
  photoUrl: string | null
}

export type ShareErrorResponse = { error: string }

/**
 * 服务端卡片图的相对路径（Track A 与 Track B 的唯一共享契约）。
 * pointId 可能含冒号（`101:station`），进 URL 必须编码；photo 传的是
 * `checkin/<userId>/<pointId>.jpg` 形状的 R2 key，空值时整个参数不出现。
 */
export function buildCardImagePath(
  pointId: string,
  locale: SupportedLocale,
  layout: ShareCardLayout,
  photoKey?: string | null,
): string {
  const params = new URLSearchParams()
  params.set('locale', locale)
  params.set('layout', layout)
  const photo = String(photoKey || '').trim()
  if (photo) params.set('photo', photo)
  return `/api/share/card/${encodeURIComponent(pointId)}?${params.toString()}`
}

export function isShareCardLayout(value: unknown): value is ShareCardLayout {
  return value === 'portrait' || value === 'landscape'
}

export function isShareChannel(value: unknown): value is ShareChannel {
  return typeof value === 'string' && (SHARE_CHANNELS as readonly string[]).includes(value)
}

/** 短链相对路径；渠道参数只在真正要发出去时才带 */
export function shareLinkPath(code: string, channel?: ShareChannel): string {
  return channel ? `/s/${code}?c=${channel}` : `/s/${code}`
}

/**
 * 分享卡片的点位上下文：地址（按 locale 取一条）、坐标、说明、是否在日本轮廓 bbox 内、
 * 去掉作品名前缀的点位名、作品名。由 GET /api/share/point-context 返回。
 */
export type PointContextResponse = {
  address: string | null
  geo: [number, number] | null
  note: string | null
  inJapan: boolean
  displayName: string
  animeTitle: string
}

/**
 * Natural Earth 50m 日本轮廓（公有领域）：`{bbox, rings}`，34 个环共 1097 个点，
 * 环的坐标是 `[lon, lat]`。与卡片定位小图共用同一份数据（Track B 改从这里 import）。
 */
type JapanOutline = {
  bbox: readonly [number, number, number, number]
  rings: readonly (readonly (readonly [number, number])[])[]
}

const JAPAN_OUTLINE = japanOutlineJson as unknown as JapanOutline

/**
 * 整体外接框，仅供参考；判定见 isInJapan。直接从轮廓 JSON 的 bbox 派生，
 * 不再手工放宽——真正的国界判定由多边形射线法完成，bbox 只做快速排除。
 */
export const JAPAN_BBOX: readonly [number, number, number, number] = JAPAN_OUTLINE.bbox

/**
 * 射线法（ray casting）点在多边形内判定：从待测点向右水平射出一条射线，
 * 与环边线的交点数为奇数则在多边形内。环不闭合（首尾点相同）也能正确工作。
 */
function pointInRing(lat: number, lng: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i]!
    const [lngJ, latJ] = ring[j]!
    const crosses = latI > lat !== latJ > lat
    if (!crosses) continue
    const lngAtLat = ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI
    if (lng < lngAtLat) inside = !inside
  }
  return inside
}

export function isInJapan(lat: number, lng: number): boolean {
  const [minLon, minLat, maxLon, maxLat] = JAPAN_BBOX
  if (lng < minLon || lng > maxLon || lat < minLat || lat > maxLat) return false
  return JAPAN_OUTLINE.rings.some((ring) => pointInRing(lat, lng, ring))
}
