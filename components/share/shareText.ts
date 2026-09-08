import type { SupportedLocale } from '@/lib/i18n/types'
import type { ShareChannel } from '@/lib/share/types'

export type ShareCaptionVars = {
  anime: string
  point: string
  city: string
  url: string
}

/**
 * 填模板。城市为空时，把包住 {city} 的中/英标点（全角括号、逗号+空格）一并吃掉，
 * 免得出现「须贺神社（）」或「Suga Shrine,  https://…」。
 * `#{anime}` 是话题标签：作品名先过 toHashtag 净化，再替换普通 `{anime}`。
 */
export function buildShareCaption(template: string, vars: ShareCaptionVars): string {
  const city = String(vars.city || '').trim()
  const anime = String(vars.anime || '').trim()
  const animeTag = toHashtag(anime)
  let out = String(template || '')
  out = city
    ? out.replace(/\{city\}/g, city)
    : out.replace(/（\{city\}）/g, ' ').replace(/,\s*\{city\}/g, '').replace(/\{city\}/g, '')
  out = out
    .replace(/#\{anime\}/g, animeTag ? `#${animeTag}` : '')
    .replace(/\{anime\}/g, anime)
    .replace(/\{point\}/g, String(vars.point || '').trim())
    .replace(/\{url\}/g, String(vars.url || '').trim())
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

/** 话题标签化：去掉空白与 `# / \ . , : ; ! ? ' " ( ) （ ） 【 】 「 」 『 』 ・`，免得作品名里的符号把话题拆断 */
export function toHashtag(value: string): string {
  return String(value || '').replace(/[\s#/\\.,:;!?'"()（）【】「」『』・]+/gu, '')
}

/** 给短链挂上渠道参数；已有 c 就覆盖 */
export function withShareChannel(shareUrl: string, channel: ShareChannel): string {
  try {
    const url = new URL(shareUrl)
    url.searchParams.set('c', channel)
    return url.toString()
  } catch {
    return shareUrl
  }
}

export function buildXIntentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
}

export function buildRedditSubmitUrl(url: string, title: string): string {
  return `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`
}

export function buildLineShareUrl(url: string, text: string): string {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}

/**
 * 分享卡片文件名：点位名只保留各国文字/数字/_/-，其余折叠成单个 -，截 40 字符。
 * 下载与系统分享共用，避免裸点位名里的空白/符号在部分系统上变成非法文件名。
 */
export function buildCardFilename(name: string): string {
  const slug = String(name || '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40)
  return `seichigo-${slug || 'card'}.jpg`
}

/**
 * 城市级地址：都道府县 + 市区町村。
 * zh/ja 的地址是「粗 → 细」空格分隔，取前两级并去掉空格（東京都武蔵野市）；
 * en 是「细 → 粗」逗号分隔，最粗的两级在末尾（Musashino, Tokyo）。
 */
export function toCityLevelAddress(address: string, locale: SupportedLocale): string {
  const raw = String(address || '').trim()
  if (!raw) return ''
  if (locale === 'en') {
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean)
    return parts.slice(-2).join(', ')
  }
  const parts = raw.split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).join('')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 用户编辑过文案之后，各个目的地按钮仍然要带各自的 `?c=`。
 * 这里只替换文案里的那条短链（含已有的 ?c=xx），其余文字原样保留。
 */
export function retargetCaptionChannel(
  caption: string,
  shareUrl: string,
  channel: ShareChannel,
): string {
  const base = String(shareUrl || '').trim()
  if (!base) return String(caption || '')
  const target = withShareChannel(base, channel)
  return String(caption || '').replace(
    new RegExp(`${escapeRegExp(base)}(?:\\?c=[A-Za-z]+)?`, 'g'),
    target,
  )
}
