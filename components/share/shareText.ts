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
