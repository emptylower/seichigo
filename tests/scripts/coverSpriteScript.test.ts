import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  buildCoverSpriteSheet,
  computeCoverSpriteVersion,
  planCoverSpriteGrid,
  renderAvatarTile,
} from '@/scripts/coverSpriteScript'

async function tinyCoverPng(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 24, height: 40, channels: 3, background: color },
  })
    .png()
    .toBuffer()
}

describe('planCoverSpriteGrid', () => {
  it('packs icons into a near-square grid', () => {
    expect(planCoverSpriteGrid(0)).toEqual({ cols: 0, rows: 0 })
    expect(planCoverSpriteGrid(1)).toEqual({ cols: 1, rows: 1 })
    expect(planCoverSpriteGrid(4)).toEqual({ cols: 2, rows: 2 })
    expect(planCoverSpriteGrid(5)).toEqual({ cols: 3, rows: 2 })
    expect(planCoverSpriteGrid(118)).toEqual({ cols: 11, rows: 11 })
  })
})

describe('renderAvatarTile', () => {
  it('produces a 72×72 tile with circular alpha (center-cropped portrait cover)', async () => {
    const tile = await renderAvatarTile(await tinyCoverPng({ r: 200, g: 30, b: 30 }))
    const meta = await sharp(tile).metadata()
    expect(meta.width).toBe(72)
    expect(meta.height).toBe(72)
    expect(meta.format).toBe('png')

    // 角落必须透明（圆形头像），中心不透明
    const { data, info } = await sharp(tile).raw().toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]!
    expect(alphaAt(1, 1)).toBe(0)
    expect(alphaAt(36, 36)).toBeGreaterThan(200)
  })
})

describe('buildCoverSpriteSheet', () => {
  it('composites a grid webp with a content-hash atlas', async () => {
    const icons = [
      { bangumiId: 101, coverBytes: await tinyCoverPng({ r: 200, g: 30, b: 30 }) },
      { bangumiId: 202, coverBytes: await tinyCoverPng({ r: 30, g: 200, b: 30 }) },
      { bangumiId: 303, coverBytes: await tinyCoverPng({ r: 30, g: 30, b: 200 }) },
    ]

    const { sheet, atlas } = await buildCoverSpriteSheet(icons)

    expect(atlas.count).toBe(3)
    expect(atlas.tile).toBe(72)
    expect(atlas.grid).toEqual([2, 2])
    expect(atlas.icons['101']).toEqual([0, 0])
    expect(atlas.icons['202']).toEqual([1, 0])
    expect(atlas.icons['303']).toEqual([0, 1])

    const meta = await sharp(sheet).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(144)
    expect(meta.height).toBe(144)

    // 版本号 = sheet 内容 hash：内容变 → 版本变
    expect(atlas.version).toBe(computeCoverSpriteVersion(sheet))
    const other = await buildCoverSpriteSheet([
      { bangumiId: 101, coverBytes: await tinyCoverPng({ r: 1, g: 2, b: 3 }) },
    ])
    expect(other.atlas.version).not.toBe(atlas.version)
  })

  it('skips invalid entries instead of failing the whole sheet', async () => {
    const { atlas, skipped } = await buildCoverSpriteSheet([
      { bangumiId: -1, coverBytes: Buffer.alloc(8) },
      { bangumiId: 101, coverBytes: await tinyCoverPng({ r: 9, g: 9, b: 9 }) },
      { bangumiId: 202, coverBytes: Buffer.alloc(0) },
    ])

    expect(atlas.count).toBe(1)
    expect(Object.keys(atlas.icons)).toEqual(['101'])
    expect(skipped).toBe(2)
  })

  it('rejects empty inputs', async () => {
    await expect(buildCoverSpriteSheet([])).rejects.toThrow('无可用图标')
  })
})
