/**
 * 服务端预生成封面 sprite 的客户端切片器（2026-09-10 Lane A 任务 3）。
 *
 * 命中路径：一次 atlas 请求 + 一次 sheet 请求（同源 Worker 路由，边缘缓存），
 * 之后所有 viewport 内番剧头像都从 sheet 本地切片 —— complete 模式图标请求
 * 从 ~118 降到 1–2。atlas/sheet 缺失、解析失败、无 DOM canvas 时返回空 Map，
 * CoverAvatarLoader 对缺 tile 的番剧逐个回落到旧的「候选梯逐张加载」路径。
 */
import {
  coverSpriteTileRect,
  parseCoverSpriteAtlas,
  type CoverSpriteAtlas,
} from '@/lib/anitabi/coverSpriteAtlas'

export type CoverSpriteTile = ImageData

export interface CoverSpriteSource {
  loadTiles(
    bangumiIds: ReadonlyArray<number>,
    signal?: AbortSignal,
  ): Promise<Map<number, CoverSpriteTile>>
}

const ATLAS_URL = '/api/anitabi/sprite'
const SHEET_URL = '/api/anitabi/sprite/sheet'
/** atlas 404/失败后的负缓存：避免每次 viewport 更新都重打失败请求 */
const NEGATIVE_TTL_MS = 5 * 60_000
/** 成功 atlas 的内存 TTL：与服务端 s-maxage=300 的新鲜度口径一致 */
const ATLAS_TTL_MS = 5 * 60_000

type SheetImage = CanvasImageSource & {
  width: number
  height: number
  naturalWidth?: number
  naturalHeight?: number
}

function canSliceTiles(): boolean {
  return typeof document !== 'undefined' && typeof fetch === 'function'
}

function sliceTile(
  sheet: SheetImage,
  rect: { x: number; y: number; width: number; height: number },
): CoverSpriteTile | null {
  const canvas = document.createElement('canvas')
  canvas.width = rect.width
  canvas.height = rect.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(sheet, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  try {
    return ctx.getImageData(0, 0, rect.width, rect.height)
  } catch {
    return null
  }
}

function loadSheetImage(version: string, signal?: AbortSignal): Promise<SheetImage> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const img = new Image()
    const cleanup = () => {
      img.onload = null
      img.onerror = null
    }
    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('sheet load failed'))
    }
    img.src = `${SHEET_URL}?v=${encodeURIComponent(version)}`
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          cleanup()
          img.src = ''
          reject(new Error('Aborted'))
        },
        { once: true },
      )
    }
  })
}

/**
 * 模块级共享状态：同一页面里多次 viewport 更新只发一次 atlas/sheet 请求。
 * 成功的 atlas 按 ATLAS_TTL_MS 常驻内存；失败后 NEGATIVE_TTL 内不再尝试。
 */
const sharedState = {
  atlasCache: null as { atlas: CoverSpriteAtlas; fetchedAt: number } | null,
  atlasInFlight: null as Promise<CoverSpriteAtlas | null> | null,
  atlasFailedAt: 0,
  sheetByVersion: new Map<string, Promise<SheetImage | null>>(),
}

async function fetchAtlas(signal?: AbortSignal): Promise<CoverSpriteAtlas | null> {
  if (sharedState.atlasCache && Date.now() - sharedState.atlasCache.fetchedAt < ATLAS_TTL_MS) {
    return sharedState.atlasCache.atlas
  }
  if (sharedState.atlasFailedAt && Date.now() - sharedState.atlasFailedAt < NEGATIVE_TTL_MS) {
    return null
  }
  if (!sharedState.atlasInFlight) {
    sharedState.atlasInFlight = (async () => {
      try {
        const res = await fetch(ATLAS_URL, { signal })
        if (!res.ok) {
          sharedState.atlasFailedAt = Date.now()
          return null
        }
        const parsed = parseCoverSpriteAtlas(await res.json())
        if (!parsed) {
          sharedState.atlasFailedAt = Date.now()
          return null
        }
        sharedState.atlasCache = { atlas: parsed, fetchedAt: Date.now() }
        return parsed
      } catch {
        sharedState.atlasFailedAt = Date.now()
        return null
      } finally {
        sharedState.atlasInFlight = null
      }
    })()
  }
  return sharedState.atlasInFlight
}

function fetchSheet(
  atlas: CoverSpriteAtlas,
  signal?: AbortSignal,
): Promise<SheetImage | null> {
  const cached = sharedState.sheetByVersion.get(atlas.version)
  if (cached) return cached
  const promise = loadSheetImage(atlas.version, signal)
    .then((img) => {
      const w = img.naturalWidth ?? img.width
      const h = img.naturalHeight ?? img.height
      if (w <= 0 || h <= 0) return null
      return img
    })
    .catch(() => {
      sharedState.sheetByVersion.delete(atlas.version)
      return null
    })
  // 只保留最近的 sheet（版本切换时旧 sheet 自然被 GC）
  if (sharedState.sheetByVersion.size > 2) {
    sharedState.sheetByVersion.clear()
  }
  sharedState.sheetByVersion.set(atlas.version, promise)
  return promise
}

/** 供测试重置共享状态。 */
export function __resetCoverSpriteSharedStateForTests(): void {
  sharedState.atlasCache = null
  sharedState.atlasInFlight = null
  sharedState.atlasFailedAt = 0
  sharedState.sheetByVersion.clear()
}

export function createCoverSpriteSource(): CoverSpriteSource {
  return {
    async loadTiles(bangumiIds, signal) {
      const tiles = new Map<number, CoverSpriteTile>()
      if (!canSliceTiles() || bangumiIds.length === 0) return tiles

      const atlas = await fetchAtlas(signal)
      if (!atlas || signal?.aborted) return tiles
      const sheet = await fetchSheet(atlas, signal)
      if (!sheet || signal?.aborted) return tiles

      for (const bangumiId of bangumiIds) {
        if (signal?.aborted) break
        const rect = coverSpriteTileRect(atlas, bangumiId)
        if (!rect) continue
        const tile = sliceTile(sheet, rect)
        if (tile) tiles.set(bangumiId, tile)
      }
      return tiles
    },
  }
}
