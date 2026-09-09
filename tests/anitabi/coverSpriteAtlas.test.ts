import { describe, expect, it } from 'vitest'
import {
  COVER_SPRITE_R2_PREFIX,
  coverSpriteAtlasKey,
  coverSpriteSheetKey,
  coverSpriteTileRect,
  parseCoverSpriteAtlas,
} from '@/lib/anitabi/coverSpriteAtlas'

describe('cover sprite atlas 契约', () => {
  it('derives stable r2 keys for sheet and atlas', () => {
    expect(coverSpriteSheetKey('a1b2c3d4e5f6')).toBe('sprites/v2/sheet-a1b2c3d4e5f6.webp')
    expect(coverSpriteAtlasKey()).toBe('sprites/v2/atlas.json')
    expect(COVER_SPRITE_R2_PREFIX).toBe('sprites/v2')
  })

  it('parses a valid atlas', () => {
    const atlas = parseCoverSpriteAtlas({
      version: 'a1b2c3d4e5f6',
      tile: 72,
      grid: [3, 2],
      count: 2,
      icons: { '328609': [0, 0], '290980': [2, 1] },
    })
    expect(atlas).toMatchObject({
      version: 'a1b2c3d4e5f6',
      tile: 72,
      grid: [3, 2],
      count: 2,
    })
  })

  it('rejects malformed atlases (client must fall back)', () => {
    expect(parseCoverSpriteAtlas(null)).toBeNull()
    expect(parseCoverSpriteAtlas('x')).toBeNull()
    expect(parseCoverSpriteAtlas({ version: 'NOT-A-VERSION', tile: 72, grid: [1, 1], icons: {} })).toBeNull()
    expect(parseCoverSpriteAtlas({ version: 'a1b2c3d4e5f6', tile: 0, grid: [1, 1], icons: {} })).toBeNull()
    expect(parseCoverSpriteAtlas({ version: 'a1b2c3d4e5f6', tile: 72, grid: [1], icons: {} })).toBeNull()
    // 坐标越界
    expect(
      parseCoverSpriteAtlas({ version: 'a1b2c3d4e5f6', tile: 72, grid: [1, 1], icons: { '1': [1, 0] } }),
    ).toBeNull()
    // 非数字键
    expect(
      parseCoverSpriteAtlas({ version: 'a1b2c3d4e5f6', tile: 72, grid: [2, 1], icons: { 'abc': [0, 0] } }),
    ).toBeNull()
  })

  it('computes pixel rects from grid coordinates', () => {
    const atlas = parseCoverSpriteAtlas({
      version: 'a1b2c3d4e5f6',
      tile: 72,
      grid: [3, 2],
      count: 1,
      icons: { '7': [2, 1] },
    })!
    expect(coverSpriteTileRect(atlas, 7)).toEqual({ x: 144, y: 72, width: 72, height: 72 })
    expect(coverSpriteTileRect(atlas, 8)).toBeNull()
    expect(coverSpriteTileRect(atlas, -1)).toBeNull()
  })
})
