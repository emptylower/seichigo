import type { SiteLocale } from '@/components/layout/SiteShell'
import { t } from '@/lib/i18n'

/**
 * 第二屏「全球点位数据库」的纯函数：数字取整、副标题拼接、城市标签的
 * 像素碰撞规避。组件（HomeMapDatabase.tsx）只做渲染与地图装配，
 * 这里的一切都能在 node 里直接单测。
 */

/** 数字格式化 locale（沿用旧 HomeMapTeaser 的口径） */
export const NUMBER_LOCALE: Record<SiteLocale, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP' }

/** 超大数字：totalPoints 向下取整到千位（50597 → 50000），「+」由组件另加 */
export function roundDownToThousands(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0
  return Math.floor(points / 1000) * 1000
}

/** 取整后的千分位文本（按 locale 分组） */
export function formatRoundedTotal(points: number, locale: SiteLocale): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale]).format(roundDownToThousands(points))
}

/** 统计胶囊里的数字（作品/城市/攻略），按 locale 分组 */
export function formatStatNumber(value: number, locale: SiteLocale): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale]).format(value)
}

/**
 * 副标题：「来自 {works} 部动漫作品 · 覆盖 {cities} 座城市 · 每天都在增加」。
 * stats 缺失（或字段为 0）时只保留「每天都在增加」这一小节——
 * 与 HomeHero 的 heroSubtitle 处理 {points} 缺失同口径，不把占位符漏到页面上。
 */
export function mapDbSubtitle(locale: SiteLocale, stats?: { works: number; cities: number } | null): string {
  if (!stats || !stats.works || !stats.cities) return t('pages.home.v2.mapDbSubtitleTail', locale)
  return t('pages.home.v2.mapDbSubtitle', locale)
    .replace('{works}', formatStatNumber(stats.works, locale))
    .replace('{cities}', formatStatNumber(stats.cities, locale))
}

/**
 * 初始 zoom 随容器宽度在 1.2–1.8 间线性取值（lg≈1.6）：
 * 世界视野一屏内同时看到东亚、澳大利亚、北美西岸与欧洲，不再 fitBounds 到日本。
 */
export function zoomForWidth(width: number): number {
  const w = Number.isFinite(width) && width > 0 ? width : 960
  const ratio = Math.min(1, Math.max(0, (w - 320) / (1440 - 320)))
  return Math.round((1.2 + ratio * 0.6) * 100) / 100
}

/** 城市标签胶囊的估计高度（px-2.5 py-1 text-xs 白底胶囊） */
export const MAP_LABEL_HEIGHT = 26
/** 胶囊底边与点位像素坐标之间的纵向间距 */
export const MAP_LABEL_GAP = 8

/** 估计胶囊宽度：CJK 全角按 12px、其余按 7px，外加左右 padding 与余量 */
export function estimateMapLabelWidth(text: string): number {
  let width = 22
  for (const ch of text) {
    width += /[⺀-鿿豈-﫿　-〿]/.test(ch) ? 12 : 7

  }
  return width
}

export type MapLabelRect = { left: number; top: number; right: number; bottom: number }

/** 标签矩形：以点位像素坐标为锚，水平居中、整体在点位上方 */
export function mapLabelRect(x: number, y: number, width: number, height = MAP_LABEL_HEIGHT): MapLabelRect {
  const bottom = y - MAP_LABEL_GAP
  return { left: x - width / 2, top: bottom - height, right: x + width / 2, bottom }
}

export function rectsOverlap(a: MapLabelRect, b: MapLabelRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export type MapLabelCandidate = { key: string; x: number; y: number; width: number }

/**
 * 城市标签的碰撞规避：输入必须已按 count 降序，逐个放置，
 * 与已放置标签的矩形相交则跳过（东京先占位，其余城市挤得下才显示）。
 */
export function placeMapLabels<T extends MapLabelCandidate>(candidates: T[]): T[] {
  const rects: MapLabelRect[] = []
  const out: T[] = []
  for (const candidate of candidates) {
    const rect = mapLabelRect(candidate.x, candidate.y, candidate.width)
    if (rects.some((placed) => rectsOverlap(placed, rect))) continue
    rects.push(rect)
    out.push(candidate)
  }
  return out
}
