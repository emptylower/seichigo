import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'
import { isGoogleProxyImageUrl } from './showcase'

/**
 * 首屏微演示数据（第十二轮第三批 A2，§0 契约）：
 * content/generated/home-showcase 之外的独立数据源 home-hero-demo.json，
 * 与第二屏展示计划分开，避免演示与正式展示共用同一份计划。
 */
export type HomeHeroDemoItem = {
  id: string
  title: string
  time: string
  imageUrl: string
}

export type HomeHeroDemoTransit = {
  mode: string
  label: string
}

export type HomeHeroDemoDay = {
  dayIndex: number
  summary: string
  items: HomeHeroDemoItem[]
  transit: HomeHeroDemoTransit
}

export type HomeHeroDemo = {
  planTitle: string
  day: HomeHeroDemoDay
}

export const HERO_DEMO_MAX_ITEMS = 3
export const HERO_DEMO_DEFAULT_TRANSIT: HomeHeroDemoTransit = {
  mode: 'walk',
  label: '步行 · 约 10 分钟',
}

/** 图片解析器：输入公开代理 URL，返回 /images/showcase/<hash>.jpg 静态路径 */
export type HeroDemoImageResolver = (proxyUrl: string) => Promise<string>

const TRANSIT_MODE_LABEL_ZH: Record<string, string> = {
  walk: '步行',
  transit: '公交',
  drive: '自驾',
  bike: '骑行',
  taxi: '出租车',
}
const DEFAULT_TRANSIT_MODE = 'walk'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function payloadRecord(item: TripPlanItemView): Record<string, unknown> | null {
  return isPlainObject(item.payload) ? item.payload : null
}

/** 可路由 = 站内点位条目且点位真实存在、有坐标（与 planAgent 的口径一致） */
function isRoutablePointItem(item: TripPlanItemView): boolean {
  return item.type === 'point' && item.point !== null && item.point.lat !== null && item.point.lng !== null
}

function heroDemoTime(item: TripPlanItemView): string {
  const schedule = isPlainObject(payloadRecord(item)?.schedule) ? payloadRecord(item)!.schedule : null
  const start = isPlainObject(schedule) && typeof schedule.start === 'string' ? schedule.start.trim() : ''
  if (start) return start
  return typeof item.timeHint === 'string' ? item.timeHint.trim() : ''
}

async function resolveHeroDemoImage(
  item: TripPlanItemView,
  resolveImage: HeroDemoImageResolver
): Promise<string | null> {
  const media = isPlainObject(payloadRecord(item)?.media) ? payloadRecord(item)!.media : null
  const mediaUrl = isPlainObject(media) && typeof media.displayUrl === 'string' ? media.displayUrl.trim() : ''
  // 已静态化的 media 直接复用；Google 图片代理（需登录）不算，回落点位图规则
  if (mediaUrl && !isGoogleProxyImageUrl(mediaUrl)) return mediaUrl

  const pointImage = typeof item.point?.image === 'string' ? item.point.image.trim() : ''
  if (!pointImage) return null
  const proxyUrl = getMapDisplayImageCandidates(pointImage, { kind: 'point-thumbnail' })[0]
  if (!proxyUrl) return null
  try {
    const staticPath = await resolveImage(proxyUrl)
    return typeof staticPath === 'string' && staticPath ? staticPath : null
  } catch {
    return null
  }
}

function heroDemoTransit(
  items: TripPlanItemView[],
  firstIndex: number,
  secondIndex: number | null
): HomeHeroDemoTransit {
  if (secondIndex !== null) {
    for (let index = firstIndex + 1; index < secondIndex; index += 1) {
      const transport = payloadRecord(items[index]!)?.transport
      if (!isPlainObject(transport)) continue
      const mode = typeof transport.mode === 'string' && transport.mode.trim()
        ? transport.mode.trim()
        : DEFAULT_TRANSIT_MODE
      const durationMin = Number(transport.durationMin)
      if (Number.isFinite(durationMin) && durationMin > 0) {
        const modeLabel = TRANSIT_MODE_LABEL_ZH[mode] ?? mode
        return { mode, label: `${modeLabel} ${Math.round(durationMin)} 分钟` }
      }
    }
  }
  return { ...HERO_DEMO_DEFAULT_TRANSIT }
}

/**
 * 选取规则（纯函数，下载器注入）：
 * - 取 dayIndex 1（缺失时第一天）；
 * - 按顺序收集"可路由且带图"的点位条目，最多 3 个；图片优先复用已静态化的
 *   media.displayUrl，否则经 point-thumbnail 代理下载，失败跳过取下一个；
 * - transit 取前两条之间的 transit 条目（"步行 N 分钟"），没有可用段回落默认。
 */
export async function pickHeroDemo(
  days: TripPlanDayView[],
  resolveImage: HeroDemoImageResolver
): Promise<HomeHeroDemoDay | null> {
  const day = days.find((entry) => entry.dayIndex === 1) ?? days[0]
  if (!day) return null

  const items: HomeHeroDemoItem[] = []
  const pickedIndexes: number[] = []
  for (let index = 0; index < day.items.length && items.length < HERO_DEMO_MAX_ITEMS; index += 1) {
    const item = day.items[index]!
    if (!isRoutablePointItem(item)) continue
    const imageUrl = await resolveHeroDemoImage(item, resolveImage)
    if (!imageUrl) continue
    items.push({ id: item.id, title: item.title, time: heroDemoTime(item), imageUrl })
    pickedIndexes.push(index)
  }
  if (items.length === 0) return null

  return {
    dayIndex: day.dayIndex,
    summary: typeof day.summary === 'string' ? day.summary : '',
    items,
    transit: heroDemoTransit(day.items, pickedIndexes[0]!, pickedIndexes[1] ?? null),
  }
}

/**
 * 读取 content/generated/home-hero-demo.json 时的形状校验：planTitle 非空，
 * day 的 dayIndex/summary/items/transit 结构完整（items 非空且每条四字段齐全，
 * transit.mode/label 非空）。结构不对返回 null，由调用方决定抛错口径。
 */
export function parseHomeHeroDemo(raw: unknown): HomeHeroDemo | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.planTitle !== 'string' || !raw.planTitle.trim()) return null

  const day = raw.day
  if (!isPlainObject(day)) return null
  if (typeof day.dayIndex !== 'number' || !Number.isFinite(day.dayIndex)) return null
  if (typeof day.summary !== 'string') return null
  if (!Array.isArray(day.items) || day.items.length === 0) return null
  for (const item of day.items) {
    if (!isPlainObject(item)) return null
    if (typeof item.id !== 'string' || !item.id.trim()) return null
    if (typeof item.title !== 'string') return null
    if (typeof item.time !== 'string') return null
    if (typeof item.imageUrl !== 'string' || !item.imageUrl.trim()) return null
  }
  const transit = day.transit
  if (!isPlainObject(transit)) return null
  if (typeof transit.mode !== 'string' || !transit.mode.trim()) return null
  if (typeof transit.label !== 'string' || !transit.label.trim()) return null

  return {
    planTitle: raw.planTitle,
    day: {
      dayIndex: day.dayIndex,
      summary: day.summary,
      items: day.items as HomeHeroDemoItem[],
      transit: { mode: transit.mode, label: transit.label },
    },
  }
}
