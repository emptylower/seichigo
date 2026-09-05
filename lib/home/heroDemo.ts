import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'
import { isGoogleProxyImageUrl } from './showcase'

/**
 * 首屏手机演示数据（第十四轮 §0 契约；第十二轮第三批 A2 初版）：
 * content/generated/home-showcase 之外的独立数据源 home-hero-demo.json，
 * 与第二屏展示计划分开，避免演示与正式展示共用同一份计划。
 * 第十四轮升级：items 带 lat/lng；transit 变为相邻点位间的一段数组；
 * 可选 map（Playwright 截的静态地图 + CSS 像素 markers）。
 * 本地化标题：items 带 titles（zh/en/ja），条目标题按站点语言显示；
 * title 保留为 zh 值（旧消费者兼容），day.summary 与 transit[].label 不本地化。
 */
export type HomeHeroDemoItemTitles = {
  zh: string
  en: string
  ja: string
}

export type HomeHeroDemoItem = {
  id: string
  title: string
  /** 多语言条目标题；title 恒等于 titles.zh */
  titles: HomeHeroDemoItemTitles
  time: string
  imageUrl: string
  lat: number
  lng: number
}

export type HomeHeroDemoTransit = {
  fromId: string
  toId: string
  mode: string
  label: string
}

export type HomeHeroDemoDay = {
  dayIndex: number
  summary: string
  items: HomeHeroDemoItem[]
  /** 相邻两个入选条目之间各一条，长度 = items.length - 1 */
  transit: HomeHeroDemoTransit[]
}

export type HomeHeroDemoMap = {
  /** '/images/home/hero-phone-map.webp' */
  src: string
  /** CSS 像素（1x） */
  width: number
  height: number
  /** 在 src 图上的 CSS 像素坐标 */
  markers: Array<{ itemId: string; x: number; y: number }>
  attribution: string
}

export type HomeHeroDemo = {
  planTitle: string
  day: HomeHeroDemoDay
  map?: HomeHeroDemoMap
}

export const HERO_DEMO_MAX_ITEMS = 3
/** §0：schedule.start 缺失时按选取顺序给固定演示时刻 */
export const HERO_DEMO_DEFAULT_TIMES = ['09:30', '10:20', '11:10'] as const
/** §0：无交通段文案时按直线距离估步行分钟的速度 */
const WALK_METERS_PER_MINUTE = 80
const EARTH_RADIUS_METERS = 6371000

/** 图片解析器：输入公开代理 URL，返回 /images/showcase/<hash>.jpg 静态路径 */
export type HeroDemoImageResolver = (proxyUrl: string) => Promise<string>

/** 选天规则可选项：anime 关键词命中点位条目标题最多的那一天 */
export type PickHeroDemoOptions = { anime?: string }

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

function heroDemoTime(item: TripPlanItemView, pickedIndex: number): string {
  const schedule = isPlainObject(payloadRecord(item)?.schedule) ? payloadRecord(item)!.schedule : null
  const start = isPlainObject(schedule) && typeof schedule.start === 'string' ? schedule.start.trim() : ''
  if (start) return start
  return HERO_DEMO_DEFAULT_TIMES[Math.min(pickedIndex, HERO_DEMO_DEFAULT_TIMES.length - 1)]!
}

/**
 * 多语言条目标题：zh = 条目标题（现值，多为「作品・地名」中文混排）；
 * ja = 库里点位原始名 point.name（通常为日文，如「須賀神社男坂上」）；
 * en = 点位英文名字段——AnitabiPoint 目前没有该字段，回退同 ja
 * （日文地名对英文读者比中文更可认）。point.name 为空时 ja/en 回退条目标题。
 */
function heroDemoTitles(item: TripPlanItemView): HomeHeroDemoItemTitles {
  const originalName = item.point?.name.trim() || item.title
  return { zh: item.title, en: originalName, ja: originalName }
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

function transitLabelFromSegment(mode: string, durationMin: number): string {
  const modeLabel = TRANSIT_MODE_LABEL_ZH[mode] ?? mode
  return `${modeLabel} ${Math.round(durationMin)} 分钟`
}

/** 两点直线距离（米），输入已是可路由条目的非空坐标 */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const latDelta = toRadians(b.lat - a.lat)
  const lngDelta = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const haversine =
    Math.sin(latDelta / 2) ** 2 + Math.sin(lngDelta / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

/** §0 缺省交通文案：按直线距离（80 m/分钟）算步行分钟，最少 1 分钟 */
function walkTransitByDistance(
  from: HomeHeroDemoItem,
  to: HomeHeroDemoItem
): HomeHeroDemoTransit {
  const meters = haversineMeters(from, to)
  const minutes = Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE))
  return { fromId: from.id, toId: to.id, mode: DEFAULT_TRANSIT_MODE, label: `步行 · 约 ${minutes} 分钟` }
}

/**
 * 相邻两个入选条目之间的交通段：两者之间只隔交通段（当天相邻）时取第一条
 * 带有效 durationMin 的原文案；中间隔了其它条目（点位/餐食等）时把中间各段
 * 的步行分钟数相加成一条「步行 N 分钟」；没有可用交通段或步行分钟则按直线
 * 距离估步行分钟。
 */
function heroDemoTransitForPair(
  dayItems: TripPlanItemView[],
  from: HomeHeroDemoItem,
  to: HomeHeroDemoItem,
  firstIndex: number,
  secondIndex: number
): HomeHeroDemoTransit {
  const segments: Array<{ mode: string; durationMin: number }> = []
  let hasEntriesBetween = false
  for (let index = firstIndex + 1; index < secondIndex; index += 1) {
    const transport = payloadRecord(dayItems[index]!)?.transport
    if (!isPlainObject(transport)) {
      hasEntriesBetween = true
      continue
    }
    const mode = typeof transport.mode === 'string' && transport.mode.trim()
      ? transport.mode.trim()
      : DEFAULT_TRANSIT_MODE
    const durationMin = Number(transport.durationMin)
    if (Number.isFinite(durationMin) && durationMin > 0) {
      segments.push({ mode, durationMin })
    }
  }
  if (!hasEntriesBetween) {
    const first = segments[0]
    if (first) {
      return { fromId: from.id, toId: to.id, mode: first.mode, label: transitLabelFromSegment(first.mode, first.durationMin) }
    }
    return walkTransitByDistance(from, to)
  }
  const walkMinutes = segments
    .filter((segment) => segment.mode === DEFAULT_TRANSIT_MODE)
    .reduce((total, segment) => total + segment.durationMin, 0)
  if (walkMinutes > 0) {
    return {
      fromId: from.id,
      toId: to.id,
      mode: DEFAULT_TRANSIT_MODE,
      label: transitLabelFromSegment(DEFAULT_TRANSIT_MODE, walkMinutes),
    }
  }
  return walkTransitByDistance(from, to)
}

/** anime 关键词命中的点位条目数（只认 point 条目的标题，transit 标题不算） */
function countAnimePointItems(day: TripPlanDayView, anime: string): number {
  return day.items.filter((item) => item.type === 'point' && item.title.includes(anime)).length
}

/**
 * 选天（§0）：给了 anime 关键词时，选标题含该词的点位条目最多的一天
 * （并列取靠前的一天；全都不命中则回落默认规则）；默认规则仍是
 * dayIndex 1（缺失时第一天）。
 */
function selectHeroDemoDay(days: TripPlanDayView[], anime?: string): TripPlanDayView | null {
  if (anime) {
    let best: TripPlanDayView | null = null
    let bestCount = 0
    for (const day of days) {
      const count = countAnimePointItems(day, anime)
      if (count > bestCount) {
        best = day
        bestCount = count
      }
    }
    if (best) return best
  }
  return days.find((entry) => entry.dayIndex === 1) ?? days[0] ?? null
}

/**
 * 选取规则（纯函数，下载器注入，第十四轮 §0）：
 * - 选天见 selectHeroDemoDay（anime 关键词计数，回落 dayIndex 1）；
 * - 优先收标题含 anime 关键词的「可路由且带图」点位条目，不足 3 个时再按
 *   原顺序用当天其它带图可路由条目补齐；入选条目按当天原顺序排列；
 * - 图片优先复用已静态化的 media.displayUrl，否则经 point-thumbnail 代理
 *   下载，失败跳过取下一个候选；
 * - time 取 schedule.start，缺失按选取顺序给 09:30 / 10:20 / 11:10；
 * - titles 见 heroDemoTitles（zh = 条目标题，ja/en = 点位原始名）；
 * - transit 为相邻入选条目之间各一条（见 heroDemoTransitForPair）。
 */
export async function pickHeroDemo(
  days: TripPlanDayView[],
  resolveImage: HeroDemoImageResolver,
  options: PickHeroDemoOptions = {}
): Promise<HomeHeroDemoDay | null> {
  const animeKeyword = options.anime?.trim() || undefined
  const day = selectHeroDemoDay(days, animeKeyword)
  if (!day) return null

  const candidates: Array<{ index: number; item: TripPlanItemView; imageUrl: string }> = []
  const collectCandidates = async (wantAnimeMatch: boolean): Promise<void> => {
    for (let index = 0; index < day.items.length && candidates.length < HERO_DEMO_MAX_ITEMS; index += 1) {
      const item = day.items[index]!
      if (!isRoutablePointItem(item)) continue
      const matchesAnime = animeKeyword ? item.title.includes(animeKeyword) : false
      if (matchesAnime !== wantAnimeMatch) continue
      const imageUrl = await resolveHeroDemoImage(item, resolveImage)
      if (!imageUrl) continue
      candidates.push({ index, item, imageUrl })
    }
  }
  await collectCandidates(true)
  await collectCandidates(false)
  candidates.sort((a, b) => a.index - b.index)
  if (candidates.length === 0) return null

  const items: HomeHeroDemoItem[] = candidates.map(({ item, imageUrl }, position) => ({
    id: item.id,
    title: item.title,
    titles: heroDemoTitles(item),
    time: heroDemoTime(item, position),
    imageUrl,
    lat: item.point!.lat!,
    lng: item.point!.lng!,
  }))

  const transit: HomeHeroDemoTransit[] = []
  for (let pair = 0; pair + 1 < items.length; pair += 1) {
    transit.push(
      heroDemoTransitForPair(day.items, items[pair]!, items[pair + 1]!, candidates[pair]!.index, candidates[pair + 1]!.index)
    )
  }

  return {
    dayIndex: day.dayIndex,
    summary: typeof day.summary === 'string' ? day.summary : '',
    items,
    transit,
  }
}

/** items.titles 解析：缺省（整个 titles 缺失、非对象或某语言缺失/非字符串）按语言回退 title */
function parseHeroDemoTitles(raw: unknown, title: string): HomeHeroDemoItemTitles {
  const pick = (value: unknown): string => (typeof value === 'string' && value.trim() ? value : title)
  if (!isPlainObject(raw)) return { zh: title, en: title, ja: title }
  return { zh: pick(raw.zh), en: pick(raw.en), ja: pick(raw.ja) }
}

function parseHeroDemoMap(map: unknown): HomeHeroDemoMap | null | undefined {
  if (map === undefined) return undefined
  if (!isPlainObject(map)) return null
  if (typeof map.src !== 'string' || !map.src.trim()) return null
  if (typeof map.attribution !== 'string' || !map.attribution.trim()) return null
  if (!Number.isFinite(map.width) || !Number.isFinite(map.height)) return null
  if (!Array.isArray(map.markers) || map.markers.length === 0) return null
  const markers: HomeHeroDemoMap['markers'] = []
  for (const marker of map.markers) {
    if (!isPlainObject(marker)) return null
    if (typeof marker.itemId !== 'string' || !marker.itemId.trim()) return null
    if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y)) return null
    markers.push({ itemId: marker.itemId, x: marker.x as number, y: marker.y as number })
  }
  return {
    src: map.src,
    width: map.width as number,
    height: map.height as number,
    markers,
    attribution: map.attribution,
  }
}

/**
 * 读取 content/generated/home-hero-demo.json 时的形状校验（第十四轮 §0）：
 * planTitle 非空；day.dayIndex/summary/items 结构完整（items 非空且每条字段
 * 齐全；lat/lng 兼容旧形状缺失时补 0；titles 兼容旧形状缺失——缺省时三语
 * 都回退 title）；transit 兼容旧形状——缺失或旧的单段对象一律归一为空数组，
 * 存在则必须每条 fromId/toId/mode/label 非空；map 可选，缺失时为 undefined
 * （前端退化为无地图演示），存在但结构非法返回 null。结构不对返回 null，
 * 由调用方决定抛错口径。
 */
export function parseHomeHeroDemo(raw: unknown): HomeHeroDemo | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.planTitle !== 'string' || !raw.planTitle.trim()) return null

  const day = raw.day
  if (!isPlainObject(day)) return null
  if (typeof day.dayIndex !== 'number' || !Number.isFinite(day.dayIndex)) return null
  if (typeof day.summary !== 'string') return null
  if (!Array.isArray(day.items) || day.items.length === 0) return null
  const items: HomeHeroDemoItem[] = []
  for (const item of day.items) {
    if (!isPlainObject(item)) return null
    if (typeof item.id !== 'string' || !item.id.trim()) return null
    if (typeof item.title !== 'string') return null
    if (typeof item.time !== 'string') return null
    if (typeof item.imageUrl !== 'string' || !item.imageUrl.trim()) return null
    items.push({
      id: item.id,
      title: item.title,
      titles: parseHeroDemoTitles(item.titles, item.title),
      time: item.time,
      imageUrl: item.imageUrl,
      lat: Number.isFinite(item.lat) ? (item.lat as number) : 0,
      lng: Number.isFinite(item.lng) ? (item.lng as number) : 0,
    })
  }

  const transit: HomeHeroDemoTransit[] = []
  if (Array.isArray(day.transit)) {
    for (const entry of day.transit) {
      if (!isPlainObject(entry)) return null
      if (typeof entry.fromId !== 'string' || !entry.fromId.trim()) return null
      if (typeof entry.toId !== 'string' || !entry.toId.trim()) return null
      if (typeof entry.mode !== 'string' || !entry.mode.trim()) return null
      if (typeof entry.label !== 'string' || !entry.label.trim()) return null
      transit.push({
        fromId: entry.fromId,
        toId: entry.toId,
        mode: entry.mode,
        label: entry.label,
      })
    }
  }

  const map = parseHeroDemoMap(raw.map)
  if (map === null) return null

  return {
    planTitle: raw.planTitle,
    day: { dayIndex: day.dayIndex, summary: day.summary, items, transit },
    ...(map ? { map } : {}),
  }
}
