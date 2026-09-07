import type { SiteLocale } from '@/components/layout/SiteShell'
import { projectMapWorld } from '@/lib/home/mapWorld'
import type { HomeMapWorldBounds, HomeMapWorldLabel } from '@/lib/home/types'
import { t } from '@/lib/i18n'

/**
 * 第二屏「全球点位数据库」的纯函数：数字取整、副标题拼接、静态世界地图
 * 城市标签的碰撞规避（百分比坐标 → 桌面基准像素 → 四方位矩形相交回退）。
 * 组件（HomeMapDatabase.tsx）只做渲染，这里的一切都能在 node 里直接单测。
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

/** 统计胶囊里的数字（作品/巡礼点位/攻略），按 locale 分组 */
export function formatStatNumber(value: number, locale: SiteLocale): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale]).format(value)
}

/**
 * 副标题：「来自 {works} 部动漫作品 · 每天都在增加」。
 * stats 缺失（或 works 为 0）时只保留「每天都在增加」这一小节——
 * 与 HomeHero 的 heroSubtitle 处理 {points} 缺失同口径，不把占位符漏到页面上。
 */
export function mapDbSubtitle(locale: SiteLocale, stats?: { works: number } | null): string {
  if (!stats || !stats.works) return t('pages.home.v2.mapDbSubtitleTail', locale)
  return t('pages.home.v2.mapDbSubtitle', locale).replace('{works}', formatStatNumber(stats.works, locale))
}

/** 城市标签胶囊的估计高度（px-2.5 py-1 text-xs 白底胶囊；primary 略大但共用同一估计） */
export const MAP_LABEL_HEIGHT = 26
/** 胶囊与点位像素坐标之间的间距（上/下为纵向、左/右为横向） */
export const MAP_LABEL_GAP = 8

/** 估计胶囊宽度：CJK 全角按 12px、其余按 7px，外加左右 padding 与余量（B-2：22 → 16） */
export function estimateMapLabelWidth(text: string): number {
  let width = 16
  for (const ch of text) {
    width += /[⺀-鿿豈-﫿　-〿]/.test(ch) ? 12 : 7
  }
  return width
}

export type MapLabelRect = { left: number; top: number; right: number; bottom: number }

/**
 * 标签锚位（B-2）：按 count 降序依次尝试 上 → 右 → 下 → 左，
 * 取第一个不与已放置矩形（含右上角「放大预览」小卡）相交的，四个都相交才跳过。
 */
export type MapLabelAnchor = 'top' | 'right' | 'bottom' | 'left'
export const MAP_LABEL_ANCHORS: readonly MapLabelAnchor[] = ['top', 'right', 'bottom', 'left']

/** 锚位对应的 CSS transform（胶囊渲染在点位百分比坐标上，再按锚位偏移一个 MAP_LABEL_GAP） */
export const MAP_LABEL_ANCHOR_TRANSFORM: Record<MapLabelAnchor, string> = {
  top: `translate(-50%, calc(-100% - ${MAP_LABEL_GAP}px))`,
  right: `translate(${MAP_LABEL_GAP}px, -50%)`,
  bottom: `translate(-50%, ${MAP_LABEL_GAP}px)`,
  left: `translate(calc(-100% - ${MAP_LABEL_GAP}px), -50%)`,
}

/** 标签矩形：以点位像素坐标为锚，按锚位偏移（top 在点位上方水平居中、right 在右侧垂直居中、依此类推） */
export function mapLabelRect(
  x: number,
  y: number,
  width: number,
  anchor: MapLabelAnchor = 'top',
  height = MAP_LABEL_HEIGHT,
): MapLabelRect {
  switch (anchor) {
    case 'right':
      return { left: x + MAP_LABEL_GAP, top: y - height / 2, right: x + MAP_LABEL_GAP + width, bottom: y + height / 2 }
    case 'bottom':
      return { left: x - width / 2, top: y + MAP_LABEL_GAP, right: x + width / 2, bottom: y + MAP_LABEL_GAP + height }
    case 'left':
      return { left: x - MAP_LABEL_GAP - width, top: y - height / 2, right: x - MAP_LABEL_GAP, bottom: y + height / 2 }
    case 'top':
    default:
      return { left: x - width / 2, top: y - MAP_LABEL_GAP - height, right: x + width / 2, bottom: y - MAP_LABEL_GAP }
  }
}

export function rectsOverlap(a: MapLabelRect, b: MapLabelRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export type MapLabelCandidate = { key: string; x: number; y: number; width: number }

/**
 * 「放大预览」小卡的占位矩形（桌面 1208px 基准）：小卡是 `absolute -right-6 -top-8
 * w-[300px]`、约 300px 高，溢出地图卡片右上边缘。预置进碰撞列表，落在这一块的
 * 标签四个锚位都试不出来就跳过（如真实数据里的纽约）。
 */
export function mapInsetCardRect(baseWidth: number): MapLabelRect {
  return { left: baseWidth + 24 - 300, top: -32, right: baseWidth + 24, bottom: -32 + 300 }
}

/**
 * 城市标签的碰撞规避：输入必须已按 count 降序，逐个放置；每个标签按
 * 上 → 右 → 下 → 左四个锚位取第一个不与已放置矩形相交的，四个都相交才跳过。
 * `occupied` 可预置已占用的矩形（如右上角「放大预览」小卡）。
 */
export function placeMapLabels<T extends MapLabelCandidate>(
  candidates: T[],
  occupied: MapLabelRect[] = [],
): Array<T & { anchor: MapLabelAnchor }> {
  const rects: MapLabelRect[] = [...occupied]
  const out: Array<T & { anchor: MapLabelAnchor }> = []
  for (const candidate of candidates) {
    for (const anchor of MAP_LABEL_ANCHORS) {
      const rect = mapLabelRect(candidate.x, candidate.y, candidate.width, anchor)
      if (rects.some((placed) => rectsOverlap(placed, rect))) continue
      rects.push(rect)
      out.push({ ...candidate, anchor })
      break
    }
  }
  return out
}

/** 静态世界地图上一条放置成功的标签（渲染只需要百分比坐标、锚位与文本） */
export type PlacedWorldMapLabel = {
  key: string
  name: string
  countText: string
  primary: boolean
  xPct: number
  yPct: number
  anchor: MapLabelAnchor
}

/**
 * 静态世界地图的标签布局：按 count 降序，用 projectMapWorld 把经纬度换算成
 * 百分比坐标，再换算成桌面基准（1x 图 1208×441）下的像素，配合估计胶囊宽度
 * 做四方位碰撞规避（右上角预置「放大预览」小卡的占位矩形）；渲染时仍按百分比
 * 定位（卡片宽度随视口缩放，标签跟随缩放）。
 */
export function placeWorldMapLabels(
  labels: HomeMapWorldLabel[],
  bounds: HomeMapWorldBounds,
  baseWidth: number,
  baseHeight: number,
  locale: SiteLocale,
): PlacedWorldMapLabel[] {
  const candidates = [...labels]
    .sort((a, b) => b.count - a.count)
    .map((label) => {
      const { xPct, yPct } = projectMapWorld(bounds, label.lng, label.lat)
      const name = label.name[locale] ?? label.name.zh
      const countText = formatStatNumber(label.count, locale)
      return {
        key: label.key,
        name,
        countText,
        primary: label.primary === true,
        xPct,
        yPct,
        x: (xPct / 100) * baseWidth,
        y: (yPct / 100) * baseHeight,
        width: estimateMapLabelWidth(`${name} ${countText}`),
      }
    })
  return placeMapLabels(candidates, [mapInsetCardRect(baseWidth)]).map((placed) => ({
    key: placed.key,
    name: placed.name,
    countText: placed.countText,
    primary: placed.primary,
    xPct: placed.xPct,
    yPct: placed.yPct,
    anchor: placed.anchor,
  }))
}

/**
 * 「放大预览」小卡里的点位标题（B-2）：title 形如「你的名字・须贺神社男坂」，
 * 显示成「须贺神社男坂 · 《你的名字》」——取「・」后的点位名 + 「・」前的作品名；
 * 没有「・」（或任一侧为空）就原样显示标题。
 */
export function mapInsetPointTitle(title: string): { pointName: string; workName: string | null } {
  const idx = title.indexOf('・')
  if (idx <= 0) return { pointName: title.trim(), workName: null }
  const workName = title.slice(0, idx).trim()
  const pointName = title.slice(idx + 1).trim()
  if (!workName || !pointName) return { pointName: title.trim(), workName: null }
  return { pointName, workName }
}
