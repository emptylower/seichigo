/**
 * generate-home-hero-bg.mts 的纯逻辑（第十四轮 §0 契约 A4）：
 * 目标宽度/编码参数/字节预算常量 + 预算检查 + sharp 编码，client 注入式
 * 可单测（小图 fixture 走真实编码管线）。
 */
import sharp from 'sharp'

export type HeroBgVariant = 'landscape' | 'portrait'

/** §0：横版 1672 宽（1672×941），竖版 941 宽（941×1672） */
export const HERO_BG_WIDTHS: Record<HeroBgVariant, number> = {
  landscape: 1672,
  portrait: 941,
}

/** §0 编码参数：AVIF q50 + WebP q78 */
export const HERO_BG_AVIF_QUALITY = 50
export const HERO_BG_WEBP_QUALITY = 78

/** §0 预算：桌面（横版）≤ 220 KB、移动（竖版）≤ 160 KB，AVIF/WebP 同标准 */
export const HERO_BG_LANDSCAPE_MAX_BYTES = 220 * 1024
export const HERO_BG_PORTRAIT_MAX_BYTES = 160 * 1024

export const HERO_BG_DEFAULT_BUDGETS: Record<HeroBgVariant, number> = {
  landscape: HERO_BG_LANDSCAPE_MAX_BYTES,
  portrait: HERO_BG_PORTRAIT_MAX_BYTES,
}

export type HeroBgFileSize = {
  variant: HeroBgVariant
  file: string
  bytes: number
}

export type HeroBgBudgetViolation = {
  file: string
  bytes: number
  budget: number
}

/** 逐文件检查预算：返回全部超预算项（空数组 = 通过）；预算可注入便于小图测试 */
export function checkHeroBgBudgets(
  sizes: HeroBgFileSize[],
  budgets: Record<HeroBgVariant, number> = HERO_BG_DEFAULT_BUDGETS
): HeroBgBudgetViolation[] {
  const violations: HeroBgBudgetViolation[] = []
  for (const entry of sizes) {
    const budget = budgets[entry.variant]
    if (entry.bytes > budget) violations.push({ file: entry.file, bytes: entry.bytes, budget })
  }
  return violations
}

export type HeroBgEncodedImages = { avif: Buffer; webp: Buffer }

/** 缩放到该变体宽度后输出 AVIF(q50) 与 WebP(q78)；保持纵横比，不放大裁切参数 */
export async function encodeHeroBg(sourcePng: Buffer, variant: HeroBgVariant): Promise<HeroBgEncodedImages> {
  const width = HERO_BG_WIDTHS[variant]
  const resized = sharp(sourcePng).resize({ width, withoutEnlargement: false })
  const [avif, webp] = await Promise.all([
    resized.clone().avif({ quality: HERO_BG_AVIF_QUALITY }).toBuffer(),
    resized.clone().webp({ quality: HERO_BG_WEBP_QUALITY }).toBuffer(),
  ])
  return { avif, webp }
}
