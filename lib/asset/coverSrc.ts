/**
 * 站内封面图按尺寸下发（2026-09-07 首页 Lighthouse 修复 §3）。
 *
 * `/assets/<id>` 路由支持 `?w=<px>&q=<1-95>` 输出缩放后的 webp（见 `lib/asset/handlers.ts`），
 * 但卡片组件直接引用原图（900×1200、335 KB 塞进 200 px 卡片）。这里统一收口
 * 原先散落在 AnimeCard / CityCard / ResourceCard / BookCover 里的四份
 * `optimizeAssetCoverSrc` 复制实现：
 * - 只对 `/assets/<id>`（相对路径，或 `https://seichigo.com/assets/…` 绝对 URL）加 `w`/`q`；
 *   其它 URL 原样返回；
 * - URL 上已有 `w`/`q` 的不覆盖。
 */

const SITE_ORIGIN = 'https://seichigo.com'

const DEFAULT_QUALITY = 75

type AssetCoverOptions = {
  width: number
  quality?: number
}

/** 解析出 /assets/ URL；非 /assets/ 或解析失败返回 null */
function parseAssetUrl(src: string): { url: URL; hasAbsolute: boolean; raw: string } | null {
  const raw = String(src || '').trim()
  if (!raw) return null

  const hasAbsolute = raw.startsWith('http://') || raw.startsWith('https://')

  try {
    const url = new URL(raw, hasAbsolute ? undefined : SITE_ORIGIN)
    if (!url.pathname.startsWith('/assets/')) return null
    return { url, hasAbsolute, raw }
  } catch {
    return null
  }
}

/** 单张图 URL：/assets/ 加 `w`/`q`（已有不覆盖），其它 URL 原样返回 */
export function assetCoverSrc(src: string, opts: AssetCoverOptions): string {
  const parsed = parseAssetUrl(src)
  if (!parsed) return String(src || '').trim()

  const { url, hasAbsolute } = parsed
  if (!url.searchParams.has('w')) url.searchParams.set('w', String(opts.width))
  if (!url.searchParams.has('q')) url.searchParams.set('q', String(opts.quality ?? DEFAULT_QUALITY))
  return hasAbsolute ? url.toString() : `${url.pathname}${url.search}`
}

/**
 * srcSet 候选串：`"…?w=320&q=75 320w, …?w=640&q=75 640w"`。
 * 非 `/assets/` URL（走不了缩放路由）返回 `undefined`，调用方不要输出 srcSet 属性。
 */
export function assetCoverSrcSet(src: string, widths: number[], quality?: number): string | undefined {
  if (!parseAssetUrl(src)) return undefined
  return widths.map((width) => `${assetCoverSrc(src, { width, quality })} ${width}w`).join(', ')
}
