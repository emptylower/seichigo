import type { SupportedLocale } from '@/lib/i18n/types'
import {
  SHARE_CARD_SIZES,
  SHARE_CHANNEL_UTM_MEDIUM,
  buildCardImagePath,
  isShareChannel,
  type ShareCardLayout,
} from '@/lib/share/types'

export function buildShareTitle(input: {
  locale: SupportedLocale
  pointName: string
  bangumiTitle: string
}): string {
  const point = String(input.pointName || '').trim()
  const anime = String(input.bangumiTitle || '').trim()
  if (input.locale === 'en') {
    const tail = `${anime} anime pilgrimage | SeichiGo`
    return point ? `${point} | ${tail}` : tail
  }
  if (input.locale === 'ja') {
    const tail = `『${anime}』聖地巡礼 | SeichiGo`
    return point ? `${point}｜${tail}` : tail
  }
  const tail = `《${anime}》圣地巡礼 | SeichiGo`
  return point ? `${point}｜${tail}` : tail
}

export function buildShareDescription(input: {
  locale: SupportedLocale
  bangumiTitle: string
  city: string | null
  ep: string | null
}): string {
  const anime = String(input.bangumiTitle || '').trim()
  const city = String(input.city || '').trim()
  const ep = String(input.ep || '').trim()

  if (input.locale === 'en') {
    const where = city ? ` in ${city}` : ''
    const episode = ep ? ` (episode ${ep})` : ''
    return `A ${anime} filming location${where}${episode}. Open the SeichiGo map for this spot and nearby routes.`
  }
  if (input.locale === 'ja') {
    const where = city ? `${city}の` : ''
    const episode = ep ? `（第${ep}話）` : ''
    return `『${anime}』${where}ロケ地${episode}。SeichiGo のマップでスポットと周辺ルートを確認できます。`
  }
  const where = city ? `在${city}的` : '的'
  const episode = ep ? `（第 ${ep} 集）` : ''
  return `《${anime}》${where}取景地${episode}。打开 SeichiGo 地图查看点位、周边点与路线。`
}

/**
 * 短链跳转目标：地图深链 + utm 三件套。`c` 的映射见 lib/share/types.ts 的
 * SHARE_CHANNEL_UTM_MEDIUM；参数顺序靠 URLSearchParams 的插入序保证。
 */
export function buildShareRedirectTarget(input: {
  locale: SupportedLocale
  bangumiId: number
  pointId: string
  channel: string | null
}): string {
  const prefix = input.locale === 'zh' ? '' : `/${input.locale}`
  const params = new URLSearchParams()
  params.set('b', String(input.bangumiId))
  params.set('p', input.pointId)
  params.set('utm_source', 'share')
  params.set('utm_medium', isShareChannel(input.channel) ? SHARE_CHANNEL_UTM_MEDIUM[input.channel] : 'unknown')
  params.set('utm_campaign', 'point_card')
  return `${prefix}/map?${params.toString()}`
}

/**
 * 短链页禁用 JS 用户的兜底链接文案：按 locale 三语。
 * 与 OG 文案同策略收在这里，不加 i18n key。
 */
export function buildShareRedirectFallbackText(input: { locale: SupportedLocale }): string {
  if (input.locale === 'en') return "Opening the map. Tap here if it doesn't redirect."
  if (input.locale === 'ja') return '地図へ移動しています。移動しない場合はこちら'
  return '正在前往地图，若未自动跳转请点此'
}

/**
 * 二维码目标：稳定的点位深链，不是短链。
 * 短链每产生一个新短码就是一次卡片缓存未命中；改成深链之后卡片才是
 * (pointId, locale, layout, photo?) 的函数，可长期缓存。
 * 渠道归因不受影响——扫码本来就固定记 image（见 SHARE_CHANNEL_UTM_MEDIUM.save）。
 */
export function buildCardQrTarget(input: {
  origin: string
  locale: SupportedLocale
  bangumiId: number
  pointId: string
}): string {
  const prefix = input.locale === 'zh' ? '' : `/${input.locale}`
  const params = new URLSearchParams()
  params.set('b', String(input.bangumiId))
  params.set('p', input.pointId)
  params.set('utm_source', 'share')
  params.set('utm_medium', 'image')
  params.set('utm_campaign', 'point_card')
  return `${input.origin}${prefix}/map?${params.toString()}`
}

/**
 * 短链页的 OG 图选路：
 * - 该链接有 imageKey（登录用户上传过带实拍的卡）→ 维持现状指向 /api/share/img/<code>，
 *   靠 ?v=<指纹> 让换图后的 URL 变化，绕开爬虫侧旧缓存
 * - 否则 → 指向服务端卡片路由的横版；匿名分享从此也有完整卡片预览
 */
export function buildShareOgImageUrl(input: {
  origin: string
  code: string
  pointId: string
  locale: SupportedLocale
  imageKey: string | null
  fingerprint: string | null
}): string {
  if (input.imageKey) {
    const version = input.fingerprint ? `?v=${input.fingerprint}` : ''
    return `${input.origin}/api/share/img/${input.code}${version}`
  }
  return `${input.origin}${buildCardImagePath(input.pointId, input.locale, 'landscape')}`
}

/**
 * OG 图 alt：点位名与作品名按 locale 拼一句。文案收在这里而不加 i18n key
 * （短链页 OG 专用，卡片 HTML 的文案仍走 t()）。
 */
export function buildShareOgImageAlt(input: {
  locale: SupportedLocale
  pointName: string
  bangumiTitle: string
}): string {
  const point = String(input.pointName || '').trim()
  const anime = String(input.bangumiTitle || '').trim()
  if (input.locale === 'en') {
    const parts = [point, anime].filter(Boolean).join(' - ')
    return `${parts || 'SeichiGo'} share card`
  }
  if (input.locale === 'ja') {
    const head = anime ? `『${anime}』` : ''
    return `${head}${point || (anime ? '聖地巡礼' : 'SeichiGo')}のシェアカード`
  }
  const head = anime ? `《${anime}》` : ''
  return `${head}${point || (anime ? '圣地巡礼' : 'SeichiGo')}分享卡片`
}

export type ShareOgImage = {
  url: string
  width: number
  height: number
  type: 'image/jpeg'
  alt: string
}

/** og:image 对象：缺 width/height/type 时部分平台（微信/LINE）不出预览 */
export function buildShareOgImage(input: {
  url: string
  layout: ShareCardLayout
  alt: string
}): ShareOgImage {
  const size = SHARE_CARD_SIZES[input.layout]
  return {
    url: input.url,
    width: size.width,
    height: size.height,
    type: 'image/jpeg',
    alt: input.alt,
  }
}
