/**
 * 首屏演示数据的**读取侧**形状（第十四轮 §0）。
 *
 * 权威形状在 `lib/home/heroDemo.ts`（A 泳道），这里刻意只声明前端要读的字段，
 * 且把 A 正在升级的两处放宽：
 * - `transit`：新契约是「相邻两点各一条」的数组，旧的是单个对象——两种都收；
 * - `lat/lng` 与 `map`：A 落盘前不存在，所以是可选。
 *
 * 这样 `HomePortalData['heroDemo']`（升级前后任一形状）都能直接传进组件，
 * 前端不必等 A 落盘，也不会在 A 落盘后再改一次组件签名。
 */
export type HeroDemoItemLike = {
  id: string
  title: string
  /**
   * A 泳道正在补的三语标题；落盘前不存在，所以这里可选、且每个语种也可选。
   * 组件按 `titles?.[locale] ?? title` 取，缺哪个语种都能安全退回 `title`。
   */
  titles?: { zh?: string; en?: string; ja?: string }
  time: string
  imageUrl: string
  lat?: number
  lng?: number
}

export type HeroDemoTransitLike = {
  fromId?: string
  toId?: string
  mode: string
  label: string
}

export type HeroDemoMarker = { itemId: string; x: number; y: number }

export type HeroDemoMapLike = {
  /** 我们自己地图的静态截图，'/images/home/hero-phone-map.webp' */
  src: string
  /** CSS 像素（1x），同时是叠加层 SVG 的 viewBox */
  width: number
  height: number
  markers: HeroDemoMarker[]
  attribution: string
}

export type HomeHeroDemoLike = {
  planTitle: string
  day: {
    dayIndex: number
    summary: string
    items: HeroDemoItemLike[]
    transit?: HeroDemoTransitLike[] | HeroDemoTransitLike | null
  }
  map?: HeroDemoMapLike
}

function isTransit(value: unknown): value is HeroDemoTransitLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.mode === 'string' && typeof record.label === 'string'
}

/** 把 `transit`（数组 / 单个对象 / 缺省）归一成数组，组件里只处理数组这一种情况 */
export function heroDemoTransits(demo: HomeHeroDemoLike | undefined): HeroDemoTransitLike[] {
  const raw = demo?.day?.transit
  if (Array.isArray(raw)) return raw.filter(isTransit)
  return isTransit(raw) ? [raw] : []
}

/**
 * 汇总行里的「步行约 N 分钟」：各段交通文案里的第一个整数求和。
 * 交通文案是生成侧写死的中文串（`步行 · 约 8 分钟`），前端不重新算距离，
 * 取不到数字就返回 0，由调用方决定不显示这一小节。
 */
export function heroWalkMinutes(transits: readonly HeroDemoTransitLike[]): number {
  let total = 0
  for (const transit of transits) {
    const match = /\d+/.exec(transit.label)
    if (match) total += Number(match[0])
  }
  return total
}

/** 地图叠加层的图钉：按 items 顺序取 markers，缺坐标的条目直接跳过 */
export function heroDemoMarkers(demo: HomeHeroDemoLike | undefined): HeroDemoMarker[] {
  const map = demo?.map
  if (!map || !Array.isArray(map.markers)) return []
  const items = demo?.day?.items ?? []
  const out: HeroDemoMarker[] = []
  for (const item of items) {
    const marker = map.markers.find((entry) => entry.itemId === item.id)
    if (marker) out.push(marker)
  }
  return out
}
