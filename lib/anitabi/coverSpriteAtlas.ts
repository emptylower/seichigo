/**
 * 服务端预生成封面图标 sprite sheet 的共享契约（2026-09-10 Lane A 任务 3）。
 *
 * 产物（R2，桶 seichigo-anitabi-images）：
 *   sprites/v2/sheet-<version>.webp   —— 全部 mapEnabled 番剧的 72×72 圆形
 *                                        头像（白底圆盘 + 3px 白环 + 中心裁切
 *                                        封面），内容 hash 版本号、不可变；
 *   sprites/v2/atlas.json             —— { version, tile, grid, count, icons }，
 *                                        bangumiId → [col, row]，可整体重写。
 *
 * 生成端（scripts/coverSpriteScript.ts）与消费端
 * （components/map/utils/coverSpriteSource.ts）共用本文件的解析与几何计算，
 * 保证两侧口径零漂移。客户端经同源 Worker 路由读取（R2 公共域 CORS 未开，
 * canvas 切片会 taint）：
 *   GET /api/anitabi/sprite            —— atlas（s-maxage 边缘缓存）
 *   GET /api/anitabi/sprite/sheet?v=…  —— webp（immutable + 边缘缓存）
 */

export const COVER_SPRITE_R2_PREFIX = 'sprites/v2'

/** 与 coverAvatarLoader.toAvatarImageData 的视觉口径一致 */
export const COVER_SPRITE_TILE_SIZE = 72
export const COVER_SPRITE_BORDER = 3

export type CoverSpriteAtlas = {
  version: string
  tile: number
  /** [cols, rows] */
  grid: [number, number]
  count: number
  /** bangumiId（字符串键）→ [col, row] */
  icons: Record<string, [number, number]>
}

export function coverSpriteSheetKey(version: string): string {
  return `${COVER_SPRITE_R2_PREFIX}/sheet-${version}.webp`
}

export function coverSpriteAtlasKey(): string {
  return `${COVER_SPRITE_R2_PREFIX}/atlas.json`
}

export function isCoverSpriteVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8,32}$/.test(value)
}

/** 严格解析：任何字段不合法都返回 null，调用方按「无 sprite」回落。 */
export function parseCoverSpriteAtlas(input: unknown): CoverSpriteAtlas | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  if (!isCoverSpriteVersion(raw.version)) return null
  const tile = raw.tile
  if (typeof tile !== 'number' || !Number.isInteger(tile) || tile <= 0 || tile > 512) return null
  const grid = raw.grid
  if (
    !Array.isArray(grid)
    || grid.length !== 2
    || !grid.every((axis) => Number.isInteger(axis) && (axis as number) > 0 && (axis as number) <= 512)
  ) {
    return null
  }
  const icons = raw.icons
  if (typeof icons !== 'object' || icons === null) return null
  const entries = Object.entries(icons)
  const normalized: Record<string, [number, number]> = {}
  for (const [bangumiId, cell] of entries) {
    if (!/^\d+$/.test(bangumiId)) return null
    if (
      !Array.isArray(cell)
      || cell.length !== 2
      || !cell.every((axis) => Number.isInteger(axis) && (axis as number) >= 0)
    ) {
      return null
    }
    const [col, row] = cell as [number, number]
    if (col >= (grid[0] as number) || row >= (grid[1] as number)) return null
    normalized[bangumiId] = [col, row]
  }
  return {
    version: raw.version,
    tile,
    grid: [grid[0] as number, grid[1] as number],
    count: entries.length,
    icons: normalized,
  }
}

/** bangumiId 在 sprite 上的像素矩形；不在 atlas 内返回 null。 */
export function coverSpriteTileRect(
  atlas: CoverSpriteAtlas,
  bangumiId: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!Number.isInteger(bangumiId) || bangumiId < 0) return null
  const cell = atlas.icons[String(bangumiId)]
  if (!cell) return null
  const [col, row] = cell
  return {
    x: col * atlas.tile,
    y: row * atlas.tile,
    width: atlas.tile,
    height: atlas.tile,
  }
}
