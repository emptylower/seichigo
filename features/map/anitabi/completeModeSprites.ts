/**
 * complete 模式精灵表：视口驱动的候选选择 + 字节预算 + 切图执行。
 *
 * 背景（2026-09-10 生产实测）：桌面 /map 总字节 7.64MB，其中 5.67MB（74%）
 * 是 4 张 anitabi ptheme 精灵表。旧口径是「全量数据集按点位总数降序取前 220」，
 * 与视口完全无关，等于精准挑出数据集里最大的那批表下载，只被时间预算截断
 * （网速越快下得越多，字节量不可控）。
 *
 * 新口径：只挑「当前视口（外扩一圈）内确实有点位」的番剧，按**视口内**点位数
 * 降序，并在**发起下载之前**用估算字节判定预算。
 */
import { isValidTheme } from '@/components/map/types'
import type { AnitabiTheme } from '@/components/map/types'
import { cutSpriteSheet } from '@/components/map/utils/spriteRenderer'
import { toCanvasSafeImageUrl } from '@/lib/anitabi/imageProxy'
import { resolveAnitabiDeliveryUrl } from '@/lib/anitabi/imageNormalize'
import { distanceMeters } from './geo'
import { yieldToMainThread } from './media'

/**
 * 精灵表每格估算字节数（实测值，非经验值）。
 *
 * 出处：生产瀑布里最大的一张表 `405785_100_76.webp` = 1,934,006 B，
 * 该表 1023 格 → 1,934,006 / 1023 ≈ 1891 B/格。
 *
 * 仅用于「下载前」估算表大小以判定字节预算，不参与任何渲染计算。
 */
const COMPLETE_MODE_SPRITE_BYTES_PER_CELL = 1891

/**
 * 单次补齐的累计估算字节预算（1.5MB）。
 *
 * 依据：旧行为一次首屏就吃掉 5.67MB 精灵表；1.5MB 量级既能覆盖视口内
 * 最有用的几张表，又把首屏精灵表字节压到原来的 ~26%。
 *
 * 注意这是「本次补齐」的预算，不是全局一次性额度——否则用户平移几次之后
 * 就再也加载不到新表了。
 */
const COMPLETE_MODE_SPRITE_BYTE_BUDGET = 1_500_000

/** 视口外扩比例：预下一圈，减少小幅平移时的空窗。 */
const COMPLETE_MODE_SPRITE_VIEWPORT_PAD_RATIO = 0.25

export type SpriteBangumiInput = {
  bangumiId: number
  color: string
  theme: unknown | null
  /** geo 为 [lat, lng]，与预载 chunk 一致。 */
  points: Array<{ id: string; geo: [number, number] }>
}

export type SpriteViewportBounds = {
  west: number
  south: number
  east: number
  north: number
}

export type SpriteCandidateSelection = {
  candidates: SpriteBangumiInput[]
  /** 已入选候选的估算总字节。 */
  estimatedBytes: number
  /** 因累计字节超预算而停止取更多候选：1；否则 0。 */
  byteBudgetHit: 0 | 1
  /** 单张表估算就超过整份预算、被直接跳过的番剧数。 */
  oversizeSkipped: number
}

function normalizeLng(value: number): number {
  let next = value
  while (next > 180) next -= 360
  while (next < -180) next += 360
  return next
}

/** 估算一张精灵表的下载字节（格数 × 每格实测字节）。 */
export function estimateSpriteSheetBytes(cellCount: number): number {
  if (!Number.isFinite(cellCount) || cellCount <= 0) return 0
  return Math.round(cellCount * COMPLETE_MODE_SPRITE_BYTES_PER_CELL)
}

/** 视口外扩一圈，跨 180° 经线时退化为整圈。 */
export function padViewportBounds(
  bounds: SpriteViewportBounds,
  ratio: number = COMPLETE_MODE_SPRITE_VIEWPORT_PAD_RATIO,
): SpriteViewportBounds {
  const latSpan = Math.max(0, bounds.north - bounds.south)
  const rawLngSpan = bounds.east - bounds.west
  const lngSpan = rawLngSpan >= 0 ? rawLngSpan : rawLngSpan + 360
  const south = Math.max(-90, bounds.south - latSpan * ratio)
  const north = Math.min(90, bounds.north + latSpan * ratio)
  const lngPad = lngSpan * ratio
  if (lngSpan + lngPad * 2 >= 360) {
    return { west: -180, east: 180, south, north }
  }
  return {
    west: normalizeLng(bounds.west - lngPad),
    east: normalizeLng(bounds.east + lngPad),
    south,
    north,
  }
}

export function isPointInBounds(lat: number, lng: number, bounds: SpriteViewportBounds): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat < bounds.south || lat > bounds.north) return false
  if (bounds.east - bounds.west >= 360) return true
  if (bounds.west <= bounds.east) return lng >= bounds.west && lng <= bounds.east
  // 跨 180° 经线
  return lng >= bounds.west || lng <= bounds.east
}

/** 读取地图当前视口；拿不到（如未初始化）返回 null，调用方退化为不做视口过滤。 */
export function readMapViewportBounds(map: unknown): SpriteViewportBounds | null {
  const candidate = map as { getBounds?: () => unknown } | null
  if (!candidate || typeof candidate.getBounds !== 'function') return null
  try {
    const bounds = candidate.getBounds() as {
      getWest?: () => number
      getSouth?: () => number
      getEast?: () => number
      getNorth?: () => number
    } | null
    if (!bounds || typeof bounds.getWest !== 'function') return null
    const west = Number(bounds.getWest())
    const south = Number(bounds.getSouth!())
    const east = Number(bounds.getEast!())
    const north = Number(bounds.getNorth!())
    if (![west, south, east, north].every((value) => Number.isFinite(value))) return null
    return { west, south, east, north }
  } catch {
    return null
  }
}

/** 读取地图中心 [lng, lat]，用于同数量候选的距离兜底排序。 */
export function readMapViewportCenter(map: unknown): [number, number] | null {
  const candidate = map as { getCenter?: () => { lng?: number; lat?: number } } | null
  if (!candidate || typeof candidate.getCenter !== 'function') return null
  try {
    const center = candidate.getCenter()
    const lng = Number(center?.lng)
    const lat = Number(center?.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    return [lng, lat]
  } catch {
    return null
  }
}

/** 视口签名：用来判断 moveend 后视口是否真的变了，避免重复补齐。 */
export function buildViewportSignature(bounds: SpriteViewportBounds | null): string | null {
  if (!bounds) return null
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(3))
    .join('|')
}

type SelectSpriteCandidatesInput = {
  bangumiList: SpriteBangumiInput[]
  /** null 表示拿不到视口，退化为不做视口过滤（仍受字节预算约束）。 */
  bounds: SpriteViewportBounds | null
  center?: [number, number] | null
  /** 已处理过（下载过或尝试过）的番剧，直接跳过，保证不重复下载。 */
  isProcessed?: (bangumiId: number) => boolean
  maxBangumi: number
  byteBudget?: number
  padRatio?: number
}

/**
 * 视口驱动的精灵表候选选择：
 * 1. 只保留主题合法、且在（外扩后的）视口内确实有点位的番剧；
 * 2. 按**视口内**点位数降序，同数量时按最近点位距视口中心更近者优先；
 * 3. 下载前用估算字节累加判定预算：单张就超预算的直接跳过，
 *    累计超预算则停止取更多候选（已取的不受影响）。
 */
export function selectSpriteCandidates(input: SelectSpriteCandidatesInput): SpriteCandidateSelection {
  const {
    bangumiList,
    bounds,
    center = null,
    isProcessed,
    maxBangumi,
    byteBudget = COMPLETE_MODE_SPRITE_BYTE_BUDGET,
    padRatio = COMPLETE_MODE_SPRITE_VIEWPORT_PAD_RATIO,
  } = input

  const paddedBounds = bounds ? padViewportBounds(bounds, padRatio) : null
  const ranked: Array<{
    bangumi: SpriteBangumiInput
    visibleCount: number
    nearestDistance: number
  }> = []

  for (const bangumi of bangumiList) {
    if (!isValidTheme(bangumi.theme)) continue
    if (isProcessed?.(bangumi.bangumiId)) continue

    let visibleCount = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const point of bangumi.points) {
      const [lat, lng] = point.geo
      if (paddedBounds && !isPointInBounds(lat, lng, paddedBounds)) continue
      visibleCount += 1
      if (center) {
        const distance = distanceMeters(center, [lng, lat])
        if (distance < nearestDistance) nearestDistance = distance
      }
    }

    if (visibleCount === 0) continue
    ranked.push({ bangumi, visibleCount, nearestDistance })
  }

  ranked.sort((a, b) => {
    const countDelta = b.visibleCount - a.visibleCount
    if (countDelta !== 0) return countDelta
    const distanceDelta = a.nearestDistance - b.nearestDistance
    if (Number.isFinite(distanceDelta) && distanceDelta !== 0) return distanceDelta
    return a.bangumi.bangumiId - b.bangumi.bangumiId
  })

  const candidates: SpriteBangumiInput[] = []
  let estimatedBytes = 0
  let byteBudgetHit: 0 | 1 = 0
  let oversizeSkipped = 0

  for (const entry of ranked) {
    if (candidates.length >= maxBangumi) break
    const sheetBytes = estimateSpriteSheetBytes(entry.bangumi.points.length)
    if (sheetBytes > byteBudget) {
      // 单张巨表：跳过它（该番剧点位回落圆点），不要一次吃光预算。
      oversizeSkipped += 1
      continue
    }
    if (estimatedBytes + sheetBytes > byteBudget) {
      byteBudgetHit = 1
      break
    }
    candidates.push(entry.bangumi)
    estimatedBytes += sheetBytes
  }

  return { candidates, estimatedBytes, byteBudgetHit, oversizeSkipped }
}

/** 精灵表图片加载器：相对路径先落 canonical host，再解析为当前可用投递 host。 */
export function createSpriteImageLoader(signal: AbortSignal): (url: string) => Promise<HTMLImageElement> {
  return (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load: ${url}`))
    // www.anitabi.cn 已 NXDOMAIN；相对路径先落到 canonical host，再解析为当前可用投递 host。
    const absoluteUrl = url.startsWith('/')
      ? resolveAnitabiDeliveryUrl(`https://image.anitabi.cn${url}`).toString()
      : url
    img.src = toCanvasSafeImageUrl(absoluteUrl)

    signal.addEventListener('abort', () => {
      img.src = ''
      reject(new Error('Aborted'))
    }, { once: true })
  })
}

/** 只约束本模块会读写的两个字段，便于直接接收 globalFeatureCollection 的 Feature。 */
export type SpriteTargetFeature = { properties: { pointId: string; icon: string } }

export type SpriteBuildMapLike = {
  hasImage(id: string): boolean
  addImage(id: string, data: unknown, options?: { pixelRatio?: number }): void
}

export type SpriteBuildResult = {
  spriteImageIds: Set<string>
  /** 切图成功的番剧。 */
  loadedBangumiIds: number[]
  /** 本轮处理过的番剧（含失败），用于去重，避免下次视口变化重复下载。 */
  processedBangumiIds: number[]
  timeBudgetHit: boolean
  aborted: boolean
}

type RunSpriteBuildInput = {
  map: SpriteBuildMapLike
  candidates: SpriteBangumiInput[]
  features: SpriteTargetFeature[]
  signal: AbortSignal
  imageLoader: (url: string) => Promise<HTMLImageElement>
  /** performance.now() 口径的截止时间，超过即停（时间预算）。 */
  deadline?: number
  onProgress?: (doneCount: number) => void
  onTimeBudgetHit?: () => void
}

/** 逐个候选切图并灌入地图；失败的番剧回落圆点，按原节奏让出主线程。 */
export async function runSpriteBuild(input: RunSpriteBuildInput): Promise<SpriteBuildResult> {
  const { map, candidates, features, signal, imageLoader, deadline, onProgress, onTimeBudgetHit } = input
  const spriteImageIds = new Set<string>()
  const loadedBangumiIds: number[] = []
  const processedBangumiIds: number[] = []
  const abortedResult = (timeBudgetHit: boolean): SpriteBuildResult => ({
    spriteImageIds,
    loadedBangumiIds,
    processedBangumiIds,
    timeBudgetHit,
    aborted: true,
  })

  for (let idx = 0; idx < candidates.length; idx += 1) {
    const bangumi = candidates[idx]!
    if (signal.aborted) return abortedResult(false)

    if (deadline != null && performance.now() > deadline) {
      onTimeBudgetHit?.()
      return {
        spriteImageIds,
        loadedBangumiIds,
        processedBangumiIds,
        timeBudgetHit: true,
        aborted: false,
      }
    }

    processedBangumiIds.push(bangumi.bangumiId)
    try {
      const sprites = await cutSpriteSheet(
        bangumi.bangumiId,
        bangumi.theme as AnitabiTheme,
        bangumi.points.map((point) => ({ id: point.id })),
        bangumi.color,
        imageLoader,
      )
      if (signal.aborted) return abortedResult(false)

      for (const [imageId, sprite] of sprites.entries()) {
        if (signal.aborted) return abortedResult(false)
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, sprite.imageData, { pixelRatio: 2 })
        }
        spriteImageIds.add(imageId)
      }

      for (const feature of features) {
        const spriteKey = `sprite-${bangumi.bangumiId}-${feature.properties.pointId}`
        if (sprites.has(spriteKey)) {
          feature.properties.icon = spriteKey
        }
      }
      loadedBangumiIds.push(bangumi.bangumiId)
    } catch {
      // Sprite loading failed for this bangumi; feature falls back to dots.
    }

    onProgress?.(idx + 1)
    if ((idx + 1) % 2 === 0) {
      await yieldToMainThread(signal)
    }
  }

  return { spriteImageIds, loadedBangumiIds, processedBangumiIds, timeBudgetHit: false, aborted: false }
}

export type SpriteTopUpInput = {
  map: SpriteBuildMapLike
  bangumiList: SpriteBangumiInput[]
  features: SpriteTargetFeature[]
  /** 已处理过的番剧集合，本函数会就地补充，保证不重复下载。 */
  processedBangumiIds: Set<number>
  /** 已灌入地图的精灵图 id 集合，本函数会就地补充。 */
  spriteImageIds: Set<string>
  viewportSignatureRef: { current: string | null }
  inFlightRef: { current: boolean }
  abortRef: { current: AbortController | null }
  metrics: Record<string, number | string>
  maxBangumi: number
  budgetMs: number
  onSpritesAdded: () => void
}

/**
 * 视口变化后的增量补齐：只为「新进入视口」的番剧下表，
 * 字节预算按**本次补齐**计（不是全局一次性额度）。
 */
export function topUpSpritesForViewport(input: SpriteTopUpInput): void {
  const {
    map, bangumiList, features, processedBangumiIds, spriteImageIds,
    viewportSignatureRef, inFlightRef, abortRef, metrics, maxBangumi, budgetMs, onSpritesAdded,
  } = input
  if (inFlightRef.current || bangumiList.length === 0) return

  const bounds = readMapViewportBounds(map)
  const signature = buildViewportSignature(bounds)
  if (!bounds || signature === viewportSignatureRef.current) return
  viewportSignatureRef.current = signature

  const selection = selectSpriteCandidates({
    bangumiList,
    bounds,
    center: readMapViewportCenter(map),
    maxBangumi,
    isProcessed: (bangumiId) => processedBangumiIds.has(bangumiId),
  })
  metrics.complete_sprite_topup_byte_budget_hit = selection.byteBudgetHit
  metrics.complete_sprite_topup_oversize_skipped = selection.oversizeSkipped
  if (selection.candidates.length === 0) return

  abortRef.current?.abort()
  const controller = new AbortController()
  abortRef.current = controller
  inFlightRef.current = true
  metrics.complete_sprite_topup_total = Number(metrics.complete_sprite_topup_total || 0) + selection.candidates.length

  void runSpriteBuild({
    map,
    candidates: selection.candidates,
    features,
    signal: controller.signal,
    imageLoader: createSpriteImageLoader(controller.signal),
    deadline: performance.now() + budgetMs,
  }).then((result) => {
    for (const bangumiId of result.processedBangumiIds) processedBangumiIds.add(bangumiId)
    for (const imageId of result.spriteImageIds) spriteImageIds.add(imageId)
    metrics.complete_sprite_topup_done = Number(metrics.complete_sprite_topup_done || 0) + result.loadedBangumiIds.length
    if (result.spriteImageIds.size > 0) onSpritesAdded()
  }).catch(() => null).finally(() => {
    if (abortRef.current === controller) abortRef.current = null
    inFlightRef.current = false
  })
}
