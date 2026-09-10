/**
 * 封面图标 sprite sheet 生成逻辑（2026-09-10 Lane A 任务 3）。
 *
 * 输入：[{ bangumiId, coverBytes }] —— 调用方负责抓取封面字节（h160 变体）。
 * 输出：sheet webp（全部 72×72 圆形头像按网格排布）+ atlas JSON（bangumiId →
 * 网格坐标），version = sheet 内容 SHA-256 前 12 hex —— 内容 hash 版本号，
 * sheet 不可变、atlas 可整体重写。
 *
 * 头像视觉与 coverAvatarLoader.toAvatarImageData 完全对齐：白色圆盘
 * （r = tile/2 - 1）、3px 边距内中心裁切封面、1.5px 半透明白环。
 * sharp 经脚本侧注入，可单测（小 fixture 走真实编码管线）。
 */
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import {
  COVER_SPRITE_TILE_SIZE,
  type CoverSpriteAtlas,
} from '@/lib/anitabi/coverSpriteAtlas'

export type CoverSpriteInputIcon = {
  bangumiId: number
  coverBytes: Buffer
}

export type CoverSpriteBuildResult = {
  sheet: Buffer
  atlas: CoverSpriteAtlas
  skipped: number
}

const TILE = COVER_SPRITE_TILE_SIZE
const BORDER = 3
const WEBP_QUALITY = 80

function circleMaskSvg(size: number): Buffer {
  const r = size / 2
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${r}" cy="${r}" r="${r}" fill="#ffffff"/></svg>`,
  )
}

function discWithRingSvg(tile: number): Buffer {
  const c = tile / 2
  const inner = tile - BORDER * 2
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">` +
      `<circle cx="${c}" cy="${c}" r="${c - 1}" fill="#ffffff"/>` +
      `<circle cx="${c}" cy="${c}" r="${inner / 2}" fill="none" ` +
      `stroke="rgba(255,255,255,0.92)" stroke-width="1.5"/></svg>`,
  )
}

/** 单个头像 tile：中心裁切 → 圆形 alpha 裁剪 → 叠到白盘 + 白环上。 */
export async function renderAvatarTile(coverBytes: Buffer): Promise<Buffer> {
  const inner = TILE - BORDER * 2
  const clipped = await sharp(coverBytes)
    .rotate()
    .resize(inner, inner, { fit: 'cover' })
    .composite([{ input: circleMaskSvg(inner), blend: 'dest-in' }])
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: TILE,
      height: TILE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: discWithRingSvg(TILE) },
      { input: clipped, left: BORDER, top: BORDER },
    ])
    .png()
    .toBuffer()
}

export function planCoverSpriteGrid(count: number): { cols: number; rows: number } {
  const safeCount = Math.max(0, Math.floor(count))
  if (safeCount === 0) return { cols: 0, rows: 0 }
  const cols = Math.ceil(Math.sqrt(safeCount))
  const rows = Math.ceil(safeCount / cols)
  return { cols, rows }
}

export function computeCoverSpriteVersion(sheetBytes: Buffer): string {
  return createHash('sha256').update(sheetBytes).digest('hex').slice(0, 12)
}

export async function buildCoverSpriteSheet(
  icons: CoverSpriteInputIcon[],
): Promise<CoverSpriteBuildResult> {
  const usable = icons.filter(
    (icon) => Number.isInteger(icon.bangumiId) && icon.bangumiId >= 0 && icon.coverBytes.length > 0,
  )
  const { cols, rows } = planCoverSpriteGrid(usable.length)
  if (cols === 0 || rows === 0) {
    throw new Error('cover sprite: 无可用图标（全部封面抓取失败？）')
  }

  const iconsAtlas: Record<string, [number, number]> = {}
  const composites: Array<{ input: Buffer; left: number; top: number }> = []
  for (let index = 0; index < usable.length; index += 1) {
    const icon = usable[index]!
    const col = index % cols
    const row = Math.floor(index / cols)
    composites.push({
      input: await renderAvatarTile(icon.coverBytes),
      left: col * TILE,
      top: row * TILE,
    })
    iconsAtlas[String(icon.bangumiId)] = [col, row]
  }

  const sheet = await sharp({
    create: {
      width: cols * TILE,
      height: rows * TILE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()

  const version = computeCoverSpriteVersion(sheet)
  const atlas: CoverSpriteAtlas = {
    version,
    tile: TILE,
    grid: [cols, rows],
    count: usable.length,
    icons: iconsAtlas,
  }
  return { sheet, atlas, skipped: icons.length - usable.length }
}
