import type { SupportedLocale } from '@/lib/i18n/types'
import type { PageCardKind } from '@/lib/og/pageCardHtml'
import { getSiteOrigin } from '@/lib/seo/site'

export type PageCardImage = {
  url: string
  width: number
  height: number
  alt: string
  type: 'image/jpeg'
}

/**
 * 页面 OG 图地址：`<origin>/api/og/<kind>/<id>/<locale>.jpg`。id 段 encodeURIComponent，
 * 以 `.jpg` 结尾方便按扩展名识别图片的抓取器。URL 里不含 ver——内容变化靠
 * 响应头的短 max-age + SWR 刷新（见 handlers/pageCard.ts 的缓存头说明）。
 */
export function pageCardImage(
  kind: PageCardKind,
  id: string,
  locale: SupportedLocale,
  alt: string,
): PageCardImage {
  const origin = getSiteOrigin()
  return {
    url: `${origin}/api/og/${kind}/${encodeURIComponent(id)}/${locale}.jpg`,
    width: 1200,
    height: 630,
    alt,
    type: 'image/jpeg',
  }
}
