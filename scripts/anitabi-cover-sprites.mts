/**
 * 封面图标 sprite sheet 生成 CLI（2026-09-10 Lane A 任务 3）。
 *
 *   npx tsx scripts/anitabi-cover-sprites.mts [--out-dir out/cover-sprites] [--limit 50] [--upload]
 *
 * 流程：读库（mapEnabled 番剧 id + cover）→ 逐个抓 h160 封面字节（复用展示
 * 候选梯口径，任务 1 之后首档即 img-tc?plan=h160 ~8.6KB）→ sharp 合成网格
 * webp + atlas JSON → 落盘 out-dir。--upload 时按「先 sheet 后 atlas」顺序经
 * wrangler r2 object put 灌入 seichigo-anitabi-images 桶（atlas 是指针，永远
 * 最后写）。默认连 .env 的开发库；生产生成由 ops 用 .env.local 环境运行。
 *
 * ⚠ 2026-09-10：该表当前**不在生产启用**（CoverAvatarLoader 默认关闭
 * spriteSource——实测整表 2.63MB 无分片，盈亏平衡点 ≈306 个不同封面，
 * 普通/complete 模式用量都远低于此，灌表是净负优化）。重新灌桶/启用前
 * 必须先确认分片方案（按 viewport/zoom 只下需要的图标），否则只会退化。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvLocal, flagValue } from './homeEnv'
import { prisma } from '@/lib/db/prisma'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import {
  coverSpriteAtlasKey,
  coverSpriteSheetKey,
} from '@/lib/anitabi/coverSpriteAtlas'
import { buildCoverSpriteSheet, type CoverSpriteInputIcon } from './coverSpriteScript'

/** 与 homeEnv 同款解析：先读 .env（开发库）；生产生成在无 .env 的检出里由 .env.local 兜底。 */
async function loadEnvFiles(): Promise<void> {
  for (const name of ['.env', '.env.local']) {
    let raw: string
    try {
      raw = await readFile(path.join(process.cwd(), name), 'utf-8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]!
      let value = match[2]!.trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = value
    }
  }
  loadEnvLocal()
}

const MAX_CONCURRENT_FETCH = 6
const FETCH_TIMEOUT_MS = 20_000
const SHEET_MAX_BYTES = 4 * 1024 * 1024

function parseArgs(argv: string[]): { outDir: string; limit: number; upload: boolean } {
  return {
    outDir: flagValue(argv, '--out-dir') || 'out/cover-sprites',
    limit: Number(flagValue(argv, '--limit') || 0) || 0,
    upload: argv.includes('--upload'),
  }
}

/** 与 CoverAvatarLoader.normalizeCoverUrl 同款归一：协议相对 / 站内相对路径落回 anitabi host。 */
function normalizeCoverUrl(raw: string): string {
  if (!raw) return ''
  if (raw.startsWith('//')) return `https:${raw}`
  if (raw.startsWith('/')) return `https://www.anitabi.cn${raw}`
  return raw
}

async function fetchCoverBytes(coverUrl: string): Promise<Buffer | null> {
  const candidates = getMapDisplayImageCandidates(normalizeCoverUrl(coverUrl), { kind: 'cover' })
  for (const candidate of candidates) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      const res = await fetch(candidate, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) continue
      const contentType = String(res.headers.get('content-type') || '')
      if (!contentType.startsWith('image/')) continue
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > 0) return bytes
    } catch {
      // 候选梯下一档
    }
  }
  return null
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  await loadEnvFiles()

  const rows = await prisma.anitabiBangumi.findMany({
    where: { mapEnabled: true, cover: { not: null } },
    orderBy: [{ id: 'asc' }],
    select: { id: true, cover: true },
    ...(args.limit > 0 ? { take: args.limit } : {}),
  })
  console.log(`[cover-sprites] mapEnabled 封面：${rows.length} 条`)

  const icons: CoverSpriteInputIcon[] = []
  let failed = 0
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < rows.length) {
      const row = rows[cursor++]!
      const cover = String(row.cover || '').trim()
      if (!cover) continue
      const bytes = await fetchCoverBytes(cover)
      if (bytes) {
        icons.push({ bangumiId: row.id, coverBytes: bytes })
      } else {
        failed += 1
        console.warn(`[cover-sprites] 封面抓取失败：bangumi=${row.id} ${cover}`)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_FETCH, rows.length) }, worker),
  )
  console.log(`[cover-sprites] 抓取完成：成功 ${icons.length}，失败 ${failed}`)

  const { sheet, atlas, skipped } = await buildCoverSpriteSheet(icons)
  if (sheet.length > SHEET_MAX_BYTES) {
    throw new Error(`sheet 超预算：${sheet.length} > ${SHEET_MAX_BYTES} 字节`)
  }
  console.log(
    `[cover-sprites] sheet ${atlas.grid[0]}×${atlas.grid[1]} 格，` +
      `${atlas.count} 图标（跳过 ${skipped}），webp ${(sheet.length / 1024).toFixed(1)} KB，` +
      `version=${atlas.version}`,
  )

  await mkdir(args.outDir, { recursive: true })
  const sheetName = path.basename(coverSpriteSheetKey(atlas.version))
  await Promise.all([
    writeFile(path.join(args.outDir, sheetName), sheet),
    writeFile(
      path.join(args.outDir, 'atlas.json'),
      JSON.stringify(atlas),
    ),
  ])
  console.log(`[cover-sprites] 已写入 ${args.outDir}/${sheetName} 与 atlas.json`)

  const putCommands = [
    `wrangler r2 object put seichigo-anitabi-images/${coverSpriteSheetKey(atlas.version)} --file ${path.join(args.outDir, sheetName)} --content-type image/webp --remote`,
    `wrangler r2 object put seichigo-anitabi-images/${coverSpriteAtlasKey()} --file ${path.join(args.outDir, 'atlas.json')} --content-type application/json --remote`,
  ]
  if (args.upload) {
    const { execFile } = await import('node:child_process')
    for (const command of putCommands) {
      const [bin, ...rest] = command.split(' ')
      console.log(`[cover-sprites] $ ${command}`)
      await new Promise<void>((resolve, reject) => {
        execFile(bin!, rest, { stdio: 'inherit' }, (err) => (err ? reject(err) : resolve()))
      })
    }
    console.log('[cover-sprites] R2 上传完成（先 sheet 后 atlas）')
  } else {
    console.log('[cover-sprites] 上传命令（先 sheet 后 atlas）：')
    for (const command of putCommands) console.log(`  ${command}`)
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[cover-sprites] 失败', err)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
