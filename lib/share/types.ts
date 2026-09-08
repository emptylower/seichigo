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
