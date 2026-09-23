/**
 * 页面卡片封面读取结果（fetchImage / readSiteAsset 共用）。区分两种失败：
 * - missing（永久）：404/410、资产不存在、超过内联上限、类型不支持——照常渲染
 *   无封面卡，ver 按无封面计算；封面修好后 key 变化自动换新。
 * - transient（临时）：超时、5xx、网络异常——返回 failed、不写缓存，由兜底链接手。
 */
export type CoverImageResult =
  | { status: 'ok'; bytes: Uint8Array<ArrayBuffer>; contentType: string }
  | { status: 'missing' }
  | { status: 'transient' }

/**
 * 只接受浏览器（Browser Run）与社媒爬虫都解得开的四种位图；svg/html 会把页面
 * 当图片缓存，heic 等 Chromium 解不了——一律算不支持（永久失败）。
 */
export const PROXY_SAFE_IMAGE_PATTERN = /^image\/(jpeg|png|webp|gif)$/

/** content-type 归一：去掉 `; charset=…` 参数、小写 */
export function normalizeImageContentType(value: string | null | undefined): string {
  return String(value || '').split(';')[0]!.trim().toLowerCase()
}
