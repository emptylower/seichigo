import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  HERO_BG_LANDSCAPE_MAX_BYTES,
  HERO_BG_PORTRAIT_MAX_BYTES,
  checkHeroBgBudgets,
  encodeHeroBg,
} from '@/scripts/homeHeroBgScript'

/** 小图 fixture：32×32 纯色 PNG，走真实 sharp 编码管线验证缩放与产物格式 */
async function tinyFixturePng(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 240, g: 200, b: 210 } },
  })
    .png()
    .toBuffer()
}

describe('hero 背景图预算常量（§0）', () => {
  it('uses 220 KB for landscape and 160 KB for portrait', () => {
    expect(HERO_BG_LANDSCAPE_MAX_BYTES).toBe(220 * 1024)
    expect(HERO_BG_PORTRAIT_MAX_BYTES).toBe(160 * 1024)
  })
})

describe('checkHeroBgBudgets', () => {
  it('returns no violations when every file is within its budget', () => {
    const sizes = [
      { variant: 'landscape' as const, file: 'hero-bg-landscape.avif', bytes: 1000 },
      { variant: 'landscape' as const, file: 'hero-bg-landscape.webp', bytes: 2000 },
      { variant: 'portrait' as const, file: 'hero-bg-portrait.avif', bytes: 500 },
      { variant: 'portrait' as const, file: 'hero-bg-portrait.webp', bytes: 600 },
    ]
    expect(checkHeroBgBudgets(sizes, { landscape: 2200, portrait: 700 })).toEqual([])
  })

  it('reports each over-budget file with bytes and budget', () => {
    const sizes = [
      { variant: 'landscape' as const, file: 'hero-bg-landscape.avif', bytes: 3000 },
      { variant: 'landscape' as const, file: 'hero-bg-landscape.webp', bytes: 1000 },
      { variant: 'portrait' as const, file: 'hero-bg-portrait.avif', bytes: 800 },
      { variant: 'portrait' as const, file: 'hero-bg-portrait.webp', bytes: 900 },
    ]
    expect(checkHeroBgBudgets(sizes, { landscape: 2200, portrait: 700 })).toEqual([
      { file: 'hero-bg-landscape.avif', bytes: 3000, budget: 2200 },
      { file: 'hero-bg-portrait.avif', bytes: 800, budget: 700 },
      { file: 'hero-bg-portrait.webp', bytes: 900, budget: 700 },
    ])
  })
})

describe('encodeHeroBg（小图 fixture 走真实编码管线）', () => {
  it('resizes to the canonical widths and outputs avif + webp buffers', async () => {
    const fixture = await tinyFixturePng()

    const landscape = await encodeHeroBg(fixture, 'landscape')
    const portrait = await encodeHeroBg(fixture, 'portrait')

    const landscapeAvif = await sharp(landscape.avif).metadata()
    const landscapeWebp = await sharp(landscape.webp).metadata()
    const portraitAvif = await sharp(portrait.avif).metadata()
    const portraitWebp = await sharp(portrait.webp).metadata()

    // sharp 的 metadata 把 AVIF 容器报成 'heif'（compression av1）
    expect(['avif', 'heif']).toContain(landscapeAvif.format)
    expect(['avif', 'heif']).toContain(portraitAvif.format)
    expect(landscapeWebp.format).toBe('webp')
    expect(portraitWebp.format).toBe('webp')
    expect(landscapeAvif.width).toBe(1672)
    expect(landscapeWebp.width).toBe(1672)
    expect(portraitAvif.width).toBe(941)
    expect(portraitWebp.width).toBe(941)
    // 32×32 纯色放大后编出的文件必须远小于预算（也是小图 fixture 预算自检）
    expect(landscape.avif.byteLength).toBeLessThan(HERO_BG_LANDSCAPE_MAX_BYTES)
    expect(landscape.webp.byteLength).toBeLessThan(HERO_BG_LANDSCAPE_MAX_BYTES)
    expect(portrait.avif.byteLength).toBeLessThan(HERO_BG_PORTRAIT_MAX_BYTES)
    expect(portrait.webp.byteLength).toBeLessThan(HERO_BG_PORTRAIT_MAX_BYTES)
  })
})
