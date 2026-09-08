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
 * 日本轮廓 bbox 粗判用的经纬度范围（[minLon, minLat, maxLon, maxLat]）。
 * 与 components/share/data/japan-outline.json 的 bbox [123.68, 24.266, 145.833, 45.51] 同源，
 * 向外取整放宽一点，避免边界点位被判成海外而丢掉定位小图。
 */
export const JAPAN_BBOX: readonly [number, number, number, number] = [123.6, 24.2, 145.9, 45.6]

/**
 * 实际判定用两块矩形并集：单张 bbox 覆盖与那国岛（约 123°E）就必然把朝鲜半岛南端
 * （首尔 37.6°N / 127.0°E）一起圈进来，与「首尔算海外」的预期冲突。
 * 本土框盖本州/北海道/九州/四国/对马，西南诸岛框盖冲绳/奄美/小笠原；
 * 两框在 lat 31° 分界，韩半岛位于西南诸岛的纬度带之外，被自然排除。
 */
const JAPAN_MAINLAND_BOX: readonly [number, number, number, number] = [129.0, 31.0, 145.9, 45.6]
const JAPAN_RYUKYU_BOX: readonly [number, number, number, number] = [123.6, 24.2, 142.3, 31.0]

function inBox(lat: number, lng: number, box: readonly [number, number, number, number]): boolean {
  const [minLon, minLat, maxLon, maxLat] = box
  return lng >= minLon && lng <= maxLon && lat >= minLat && lat <= maxLat
}

export function isInJapan(lat: number, lng: number): boolean {
  return inBox(lat, lng, JAPAN_MAINLAND_BOX) || inBox(lat, lng, JAPAN_RYUKYU_BOX)
}
