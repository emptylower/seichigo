import type { SupportedLocale } from '@/lib/i18n/types'
import { SHARE_CHANNEL_UTM_MEDIUM, isShareChannel } from '@/lib/share/types'

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
