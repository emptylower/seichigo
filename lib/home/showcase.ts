import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import type { TripPlanDayView } from '@/lib/tripPlan/view'
import type { HomeShowcase } from './types'

export const SHOWCASE_SUMMARY_MAX_CHARS = 80

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 读取 content/generated/home-showcase.json 时的形状校验：只做结构性检查
 * （days[].items 必须是数组），载荷内容按 §0 契约原样透传给前端组件。
 * 结构不对返回 null，由调用方决定抛错口径。
 */
export function parseHomeShowcase(raw: unknown): HomeShowcase | null {
  if (!isPlainObject(raw)) return null
  const revisionId = typeof raw.revisionId === 'string' ? raw.revisionId.trim() : ''
  const savedAt = typeof raw.savedAt === 'string' ? raw.savedAt.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title : ''
  const summary = typeof raw.summary === 'string' ? raw.summary : ''
  if (!revisionId || !savedAt || !title) return null
  if (!Array.isArray(raw.days)) return null
  for (const day of raw.days) {
    if (!isPlainObject(day) || !Array.isArray(day.items)) return null
  }
  return {
    revisionId,
    savedAt,
    title,
    summary,
    days: raw.days as TripPlanDayView[],
  }
}

/** 句子结束符（中文为主，兼容半角叹号/问号）；句号外的英文句点不作为断句 */
const SENTENCE_TERMINATOR_RE = /[。！？!?]/
/** 过程性开头（"我先/让我先/我来"）：这类首句当摘要没有信息量，回退计划标题 */
const PROCEDURAL_OPENING_RE = /我先|让我先|我来/

/** 计划标题里"｜"之前是日期/天数段（如"2026东京圣诞周8日｜…"），摘要只留作品与主题段 */
function stripPlanTitleDateSegment(title: string): string {
  const separatorIndex = title.indexOf('｜')
  return separatorIndex >= 0 ? title.slice(separatorIndex + 1) : title
}

/**
 * summary = 第一段助手文本的第一个完整句子（以 。！？!? 结尾）；超过 80 字
 * 仍取整句并加"…"；首句含"我先/让我先/我来"等过程性开头时改用计划标题
 * （去掉 ｜ 之前的日期段）。没有助手文本时为空串。
 */
export function extractShowcaseSummary(
  messages: Array<{ kind: string; content: unknown }>,
  planTitle = ''
): string {
  for (const message of messages) {
    if (message.kind !== 'assistant') continue
    const content = message.content as { content?: unknown } | null
    if (typeof content?.content !== 'string' || !content.content.trim()) continue

    const trimmed = content.content.trim()
    const terminator = SENTENCE_TERMINATOR_RE.exec(trimmed)
    // 无结束符的整段文本按旧口径在 80 字处截断；有结束符则取第一个完整句子
    const candidate = terminator
      ? trimmed.slice(0, terminator.index + 1)
      : trimmed.slice(0, SHOWCASE_SUMMARY_MAX_CHARS)
    const overBudget = candidate.length > SHOWCASE_SUMMARY_MAX_CHARS
      || (!terminator && trimmed.length > SHOWCASE_SUMMARY_MAX_CHARS)

    if (!PROCEDURAL_OPENING_RE.test(candidate)) {
      return overBudget ? `${candidate}…` : candidate
    }
    const titleSummary = stripPlanTitleDateSegment(planTitle).trim()
    if (titleSummary) return titleSummary
    return overBudget ? `${candidate}…` : candidate
  }
  return ''
}

/** 需要登录的 Google 图片代理路径前缀（展示计划里必须静态化） */
const GOOGLE_PROXY_IMAGE_PREFIXES = ['/api/google/place-photo', '/api/google/point-photo']

export function isGoogleProxyImageUrl(url: unknown): url is string {
  return (
    typeof url === 'string'
    && GOOGLE_PROXY_IMAGE_PREFIXES.some((prefix) => url.startsWith(prefix))
  )
}

/**
 * 瘦身白名单（第十二轮审查高-3）：payload 只保留前端 itemPayload.ts 实际
 * 读取的四组字段，transport legs 只保留 11 个已知字段；placeQuery、
 * place.photos、place.photo、media.photoReference 等一切 Google 引用字段
 * 全部丢弃，保证产物里不出现需要登录态或原始引用的载荷。
 */
const SLIM_PLACE_KEYS = ['placeId', 'name', 'lat', 'lng', 'mapsUri'] as const
const SLIM_MEDIA_KEYS = ['source', 'displayUrl', 'attribution'] as const
const SLIM_SCHEDULE_KEYS = ['start', 'end', 'confidence'] as const
const SLIM_TRANSPORT_KEYS = [
  'mode', 'durationMin', 'distanceKm', 'transfers', 'walkMin', 'provider',
  'estimated', 'mapsUrl', 'note', 'source', 'legs', 'polyline',
] as const
const SLIM_LEG_KEYS = [
  'mode', 'durationMin', 'distanceKm', 'instruction', 'line', 'fromStop',
  'toStop', 'numStops', 'headsign', 'departureTime', 'arrivalTime',
] as const

/** polyline 抽稀与精度预算：≤ 80 点、坐标 5 位小数（约 1m 精度，足够预览画线） */
const POLYLINE_MAX_POINTS = 80
const POLYLINE_DECIMALS = 5

function pickKeys(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null
}

function parsePolylinePoints(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return []
  const points: Array<[number, number]> = []
  for (const entry of raw) {
    if (
      Array.isArray(entry)
      && entry.length >= 2
      && Number.isFinite(Number(entry[0]))
      && Number.isFinite(Number(entry[1]))
    ) {
      points.push([Number(entry[0]), Number(entry[1])])
    }
  }
  return points
}

function roundPolylinePoint(point: [number, number]): [number, number] {
  return [
    Number(point[0].toFixed(POLYLINE_DECIMALS)),
    Number(point[1].toFixed(POLYLINE_DECIMALS)),
  ]
}

/** 均匀抽稀到 ≤ maxPoints 个点，始终保留首尾点 */
function thinPolyline(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length <= POLYLINE_MAX_POINTS) {
    return points.map(roundPolylinePoint)
  }
  const stride = (points.length - 1) / (POLYLINE_MAX_POINTS - 1)
  const kept: Array<[number, number]> = []
  for (let i = 0; i < POLYLINE_MAX_POINTS; i += 1) {
    kept.push(roundPolylinePoint(points[Math.round(i * stride)]!))
  }
  return kept
}

function slimTransport(source: Record<string, unknown>): Record<string, unknown> {
  const out = pickKeys(source, SLIM_TRANSPORT_KEYS)
  if (Array.isArray(source.legs)) {
    out.legs = source.legs
      .map((leg) => {
        const record = asPlainObject(leg)
        if (!record) return null
        const slimLeg = pickKeys(record, SLIM_LEG_KEYS)
        // 步行段的逐向导航文案（"向北前行，走到南通り"）是产物里最大的 UTF-8
        // 体积来源且折叠摘要从不渲染（只按 mode/duration/distance 归并），
        // 为满足 ≤100KB 预算直接丢弃；乘车段文案保留。
        if (slimLeg.mode === 'walk') delete slimLeg.instruction
        return slimLeg
      })
      .filter((leg): leg is Record<string, unknown> => leg !== null)
  }
  if (Array.isArray(source.polyline)) {
    const thinned = thinPolyline(parsePolylinePoints(source.polyline))
    if (thinned.length) out.polyline = thinned
    else delete out.polyline
  }
  return out
}

function slimPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  const place = asPlainObject(payload.place)
  if (place) out.place = pickKeys(place, SLIM_PLACE_KEYS)

  const media = asPlainObject(payload.media)
  if (media) out.media = pickKeys(media, SLIM_MEDIA_KEYS)

  const schedule = asPlainObject(payload.schedule)
  if (schedule) out.schedule = pickKeys(schedule, SLIM_SCHEDULE_KEYS)

  const transport = asPlainObject(payload.transport)
  if (transport) {
    out.transport = slimTransport(transport)
  } else if (SLIM_TRANSPORT_KEYS.some((key) => payload[key] !== undefined)) {
    // M1 扁平交通载荷（mode/durationMin 挂在根上）：getTransport 同样从根读取
    Object.assign(out, slimTransport(payload))
  }

  return out
}

/**
 * 展示计划瘦身（generate-home-showcase 落盘前调用）：按白名单压缩每个条目的
 * payload，条目本身字段（id/title/note/reason/point 等）原样保留。不修改入参。
 */
export function slimShowcaseDays(days: TripPlanDayView[]): TripPlanDayView[] {
  return days.map((day) => ({
    ...day,
    items: (day.items || []).map((item) => {
      const payload = asPlainObject(item.payload)
      return payload ? { ...item, payload: slimPayload(payload) as TripPlanDayView['items'][number]['payload'] } : item
    }),
  }))
}

/** 统一下载宽度：覆盖已有的 maxwidth，避免代理按原图尺寸出图 */
export function withMaxWidth(url: string, maxwidth = 800): string {
  const queryIndex = url.indexOf('?')
  const base = queryIndex >= 0 ? url.slice(0, queryIndex) : url
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1) : ''
  const params = new URLSearchParams(query)
  params.set('maxwidth', String(maxwidth))
  return `${base}?${params.toString()}`
}

export type ShowcaseImageDownloader = (url: string) => Promise<string>

type DisplayUrlHolder = {
  /** displayUrl 所在对象（media / ln / place.photo / payload 根） */
  container: Record<string, unknown>
  /** 从 parent 删除 container 用的键；parent 为 null 表示 container 就是 payload 根 */
  parent: Record<string, unknown> | null
  key: string
}

function collectGoogleDisplayUrlHolders(
  node: Record<string, unknown>,
  parent: Record<string, unknown> | null,
  key: string,
  holders: DisplayUrlHolder[]
): void {
  if (isGoogleProxyImageUrl(node.displayUrl)) {
    holders.push({ container: node, parent, key })
  }
  for (const [childKey, value] of Object.entries(node)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectGoogleDisplayUrlHolders(value as Record<string, unknown>, node, childKey, holders)
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          collectGoogleDisplayUrlHolders(entry as Record<string, unknown>, node, childKey, holders)
        }
      }
    }
  }
}

/**
 * §0 契约的图片改写规则（generate-home-showcase 的核心纯函数）：
 * - payload 里任何指向 Google 图片代理（需登录）的 displayUrl——media / ln /
 *   place.photo 等——都交给 downloader 换成 /images/showcase/<hash>.jpg 静态路径；
 * - downloader 失败 → 删掉 displayUrl 所在的整个对象（media/ln/photo），
 *   让组件回落到 point.image 的 anitabi 原始 URL（组件侧走公开的
 *   image-render 候选梯）；
 * - 其它 URL（如 /api/anitabi/image-render）与 point.image 一律不动。
 * - A1（第十二轮第三批）：point.image 非空且无 media 的点位条目，经
 *   getMapDisplayImageCandidates(..., 'point-thumbnail')[0] 得到的公开代理 URL
 *   交给 downloader 静态化，写入 { source:'anitabi', attribution:'Anitabi' } 的
 *   media 块；失败保留无 media（前端兜底）。point.image 本身保留原值。
 * 不修改入参，返回深拷贝后的新 days。
 */
export async function rewriteShowcaseDays(
  days: TripPlanDayView[],
  downloader: ShowcaseImageDownloader,
  options: { maxWidth?: number } = {}
): Promise<TripPlanDayView[]> {
  const cloned = structuredClone(days) as TripPlanDayView[]

  for (const day of cloned) {
    for (const item of day.items || []) {
      const payload = asPlainObject(item.payload)

      if (payload) {
        const holders: DisplayUrlHolder[] = []
        collectGoogleDisplayUrlHolders(payload, null, 'payload', holders)

        for (const { container, parent, key } of holders) {
          const targetUrl = withMaxWidth(container.displayUrl as string, options.maxWidth)
          try {
            const staticPath = await downloader(targetUrl)
            if (typeof staticPath === 'string' && staticPath) {
              container.displayUrl = staticPath
            } else if (parent) {
              delete parent[key]
            } else {
              delete container.displayUrl
            }
          } catch {
            if (parent) {
              delete parent[key]
            } else {
              delete container.displayUrl
            }
          }
        }
      }

      const pointImage = typeof item.point?.image === 'string' ? item.point.image.trim() : ''
      if (pointImage && !isPlainObject(payload?.media)) {
        const proxyUrl = getMapDisplayImageCandidates(pointImage, { kind: 'point-thumbnail' })[0]
        if (proxyUrl) {
          try {
            const staticPath = await downloader(proxyUrl)
            if (typeof staticPath === 'string' && staticPath) {
              const media = {
                source: 'anitabi',
                displayUrl: staticPath,
                attribution: 'Anitabi',
              }
              if (payload) payload.media = media
              else item.payload = { media }
            }
          } catch {
            // 下载失败：保留无 media，前端回落 image-render 候选梯
          }
        }
      }
    }
  }

  return cloned
}
