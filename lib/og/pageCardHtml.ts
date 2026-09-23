import type { SupportedLocale } from '@/lib/i18n/types'
import { t } from '@/lib/i18n'
import { escapeHtml } from '@/lib/share/cardHtml'

/** 页面 OG 卡片的四类内容源；site 只有 id=home 一种 */
export type PageCardKind = 'post' | 'anime' | 'city' | 'site'

export const PAGE_CARD_WIDTH = 1200
export const PAGE_CARD_HEIGHT = 630

const KIND_LABEL_KEY: Record<PageCardKind, string> = {
  post: 'og.kindPost',
  anime: 'og.kindAnime',
  city: 'og.kindCity',
  site: 'og.kindSite',
}

/**
 * 参与 ver 哈希的文案原料（handlers/pageCard.ts 的缓存键用）：kind 标签与
 * tagline 的实际译文改动时自动换缓存键，改词条不必手 bump TEMPLATE_VERSION。
 */
export function pageCardTextFingerprint(kind: PageCardKind, locale: SupportedLocale): string {
  return `${t(KIND_LABEL_KEY[kind], locale)}|${t('og.tagline', locale)}`
}

/** 日文用日文字形、中文用简中字形；en 也标上，CJK 字符混排时按拉丁断行 */
function htmlLang(locale: SupportedLocale): string {
  if (locale === 'ja') return 'ja'
  if (locale === 'en') return 'en'
  return 'zh-CN'
}

export type PageCardHtmlInput = {
  kind: PageCardKind
  locale: SupportedLocale
  title: string
  /** 作品名 · 城市（文章）；作品简介（作品/城市） */
  subtitle: string | null
  /** data:image/...;base64,... —— 渲染时不发外部请求，保证截图确定性 */
  coverDataUri: string | null
}

/** Browser Run 环境自带中日文字体，直接点名即可（与 lib/share/cardHtml.ts 同策略） */
const FONT_STACK = 'system-ui,"Noto Sans CJK SC","Noto Sans CJK JP",sans-serif'

const PAGE_CARD_STYLES = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;overflow:hidden}
body{width:${PAGE_CARD_WIDTH}px;height:${PAGE_CARD_HEIGHT}px;background:#ffffff;font-family:${FONT_STACK};-webkit-font-smoothing:antialiased}
.card{width:${PAGE_CARD_WIDTH}px;height:${PAGE_CARD_HEIGHT}px;display:flex;background:#ffffff}
.visual{flex:none;width:520px;height:${PAGE_CARD_HEIGHT}px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.visual .cover{width:100%;height:100%;object-fit:cover;display:block}
.visual .brand{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#fff1f2,#fce7f3);font-size:96px;font-weight:800;color:#db2777;letter-spacing:.02em}
.column{flex:1;min-width:0;display:flex;flex-direction:column;padding:52px 60px 44px 56px}
.top{display:flex;align-items:center;gap:14px;margin-bottom:22px}
.brandname{font-size:26px;font-weight:700;color:#db2777;white-space:nowrap}
.kindchip{flex:none;background:#fdf2f8;border:1px solid #fbcfe8;border-radius:999px;padding:6px 18px;font-size:21px;font-weight:600;color:#be185d;white-space:nowrap}
.title{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:3;font-size:52px;line-height:1.25;font-weight:800;color:#111827;word-break:break-word}
.subtitle{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:2;margin-top:18px;font-size:26px;line-height:1.4;font-weight:400;color:#4b5563;word-break:break-word}
.spacer{flex:1;min-height:24px}
.footer{display:flex;align-items:baseline;justify-content:space-between;gap:16px;font-size:22px;font-weight:500;color:#64748b}
.tagline{font-size:20px;font-weight:400;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`.trim()

/**
 * 页面 OG 卡片的唯一渲染源：输出一份自包含的 1200×630 HTML 文档，
 * 交给 Browser Run 截图（lib/share/browserRun.ts）。封面一律内联 base64，
 * 渲染时不发任何外部请求；文字全部过 escapeHtml（标题来自 DB/MDX）。
 * 版式调整时记得同步 bump handlers/pageCard.ts 的 TEMPLATE_VERSION。
 */
export function buildPageCardHtml(input: PageCardHtmlInput): string {
  const kindLabel = t(KIND_LABEL_KEY[input.kind], input.locale)
  const tagline = t('og.tagline', input.locale)
  const visual = input.coverDataUri
    ? `<img class="cover" src="${escapeHtml(input.coverDataUri)}" alt="">`
    : '<div class="brand">SeichiGo</div>'
  const subtitle = String(input.subtitle || '').trim()
  return [
    '<!DOCTYPE html>',
    `<html lang="${escapeHtml(htmlLang(input.locale))}"><head><meta charset="utf-8">`,
    `<style>${PAGE_CARD_STYLES}</style>`,
    '</head><body><div class="card">',
    `<div class="visual">${visual}</div>`,
    '<div class="column">',
    `<div class="top"><span class="brandname">SeichiGo</span><span class="kindchip">${escapeHtml(kindLabel)}</span></div>`,
    `<div class="title">${escapeHtml(String(input.title || '').trim())}</div>`,
    subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : '',
    '<div class="spacer"></div>',
    `<div class="footer"><span>seichigo.com</span><span class="tagline">${escapeHtml(tagline)}</span></div>`,
    '</div></div></body></html>',
  ]
    .filter(Boolean)
    .join('')
}
