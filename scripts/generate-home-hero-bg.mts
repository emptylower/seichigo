/**
 * 生成首屏插画背景图（第十四轮 §0 契约 A4）。
 *
 *   npx tsx scripts/generate-home-hero-bg.mts \
 *     --landscape <png> --portrait <png> [--out-dir public/images/home]
 *
 * 源图是用户生图模型出的干净背景（无路线图钉）：横版 1672×941、竖版
 * 941×1672。sharp 缩放到约定宽度后输出 AVIF(q50) + WebP(q78) 四个文件：
 * hero-bg-landscape.{avif,webp}、hero-bg-portrait.{avif,webp}。打印每个文件
 * 大小；任一文件超预算（横版 220 KB / 竖版 160 KB）非零退出且不落盘。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { flagValue } from './homeEnv'
import { checkHeroBgBudgets, encodeHeroBg, type HeroBgFileSize } from './homeHeroBgScript'

function parseArgs(argv: string[]): { landscapeSrc: string; portraitSrc: string; outDir: string } {
  const landscapeSrc = flagValue(argv, '--landscape') || ''
  const portraitSrc = flagValue(argv, '--portrait') || ''
  const outDir = flagValue(argv, '--out-dir') || 'public/images/home'
  if (!landscapeSrc || !portraitSrc) {
    console.error(
      'usage: npx tsx scripts/generate-home-hero-bg.mts --landscape <png> --portrait <png> [--out-dir <dir>]'
    )
    process.exit(1)
  }
  return { landscapeSrc, portraitSrc, outDir }
}

async function main(): Promise<void> {
  const { landscapeSrc, portraitSrc, outDir } = parseArgs(process.argv.slice(2))

  const [landscapePng, portraitPng] = await Promise.all([
    readFile(landscapeSrc),
    readFile(portraitSrc),
  ])

  const [landscape, portrait] = await Promise.all([
    encodeHeroBg(landscapePng, 'landscape'),
    encodeHeroBg(portraitPng, 'portrait'),
  ])

  const outputs = [
    { variant: 'landscape' as const, file: 'hero-bg-landscape.avif', buffer: landscape.avif },
    { variant: 'landscape' as const, file: 'hero-bg-landscape.webp', buffer: landscape.webp },
    { variant: 'portrait' as const, file: 'hero-bg-portrait.avif', buffer: portrait.avif },
    { variant: 'portrait' as const, file: 'hero-bg-portrait.webp', buffer: portrait.webp },
  ]
  const sizes: HeroBgFileSize[] = outputs.map(({ variant, file, buffer }) => ({
    variant,
    file,
    bytes: buffer.byteLength,
  }))
  for (const entry of sizes) {
    console.log(`[hero-bg] ${entry.file} ${entry.bytes}B`)
  }

  const violations = checkHeroBgBudgets(sizes)
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`[hero-bg] ${violation.file} is ${violation.bytes}B (budget: ${violation.budget}B)`)
    }
    process.exit(1)
  }

  const outDirAbs = path.join(process.cwd(), outDir)
  await mkdir(outDirAbs, { recursive: true })
  for (const { file, buffer } of outputs) {
    await writeFile(path.join(outDirAbs, file), buffer)
  }
  console.log(`[hero-bg] 4 files written to ${outDir}/`)
}

await main()
