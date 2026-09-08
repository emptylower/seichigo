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
 */
export function buildShareCaption(template: string, vars: ShareCaptionVars): string {
  const city = String(vars.city || '').trim()
  let out = String(template || '')
  out = city
    ? out.replace(/\{city\}/g, city)
    : out.replace(/（\{city\}）/g, ' ').replace(/,\s*\{city\}/g, '').replace(/\{city\}/g, '')
  out = out
    .replace(/\{anime\}/g, String(vars.anime || '').trim())
    .replace(/\{point\}/g, String(vars.point || '').trim())
    .replace(/\{url\}/g, String(vars.url || '').trim())
  return out.replace(/[ \t]{2,}/g, ' ').trim()
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
