/**
 * 2026-09-08 图片资产迁 R2：Asset 全表备份（Postgres → NDJSON + gzip）。
 *
 *   npx tsx scripts/backup-assets.mts --yes
 *   npx tsx scripts/backup-assets.mts --help
 *
 * 输出 ~/Backups/seichigo/assets-<ISO 时间戳>.ndjson.gz，每行一条：
 *   { id, ownerId, contentType, filename, bytes(base64), storageKey, byteLength, width, height, createdAt }
 * 游标（id keyset）分批读取，不一次性把全表拉进内存。
 * 默认干跑：打印目标 host，必须显式传 --yes 才真正执行。
 * DATABASE_URL 按仓库惯例从环境变量读取（可用 scripts/homeEnv.ts 的规则手动
 * source .env / .env.local 后再运行；脚本自身不加载任何 env 文件，避免误连）。
 */
import { createGzip } from 'node:zlib'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import pg from 'pg'

const BATCH_SIZE = 200

const argv = process.argv.slice(2)

const USAGE = `Usage: npx tsx scripts/backup-assets.mts [--yes]

  --yes    真正执行备份（默认干跑：只打印目标 host 后退出）
  --help   显示本说明

读取 DATABASE_URL（pg 连接串），输出到 ~/Backups/seichigo/assets-<ISO>.ndjson.gz。
bytes 列以 base64 编码写入 NDJSON，整体 gzip 压缩。`

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE)
  process.exit(0)
}

function dbHost(dbUrl: string): string {
  try {
    return new URL(dbUrl).host
  } catch {
    return '(无法解析 host)'
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL 未设置。请先 export（注意区分 dev 库与生产库）。')
    process.exit(1)
  }

  const host = dbHost(dbUrl)
  const outDir = join(homedir(), 'Backups', 'seichigo')
  const iso = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = join(outDir, `assets-${iso}.ndjson.gz`)

  console.log(`目标数据库 host: ${host}`)
  console.log(`输出文件: ${outPath}`)

  if (!argv.includes('--yes')) {
    console.error('\n干跑模式：未执行任何读取/写入。确认无误后加 --yes 重跑。')
    process.exit(1)
  }

  await mkdir(dirname(outPath), { recursive: true })
  const client = new pg.Client({ connectionString: dbUrl })
  const gzip = createGzip()
  const fileStream = createWriteStream(outPath)
  gzip.pipe(fileStream)

  let rows = 0
  let totalBytes = 0
  let cursor = ''

  await client.connect()
  try {
    for (;;) {
      const result = await client.query(
        // SELECT *：备份可能在 R2 迁移列（storageKey 等）加入之前执行，按实际存在的列导出
        `SELECT * FROM "Asset" WHERE id > $1 ORDER BY id LIMIT $2`,
        [cursor, BATCH_SIZE],
      )
      if (result.rows.length === 0) break
      for (const row of result.rows) {
        const buf: Buffer = row.bytes
        totalBytes += buf.byteLength
        gzip.write(
          JSON.stringify({
            id: row.id,
            ownerId: row.ownerId,
            contentType: row.contentType,
            filename: row.filename,
            bytes: buf.toString('base64'),
            storageKey: row.storageKey,
            byteLength: row.byteLength,
            width: row.width,
            height: row.height,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
          }) + '\n',
        )
        rows++
        cursor = row.id
      }
      if (result.rows.length < BATCH_SIZE) break
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      gzip.end(() => resolve())
      fileStream.on('finish', () => resolve())
      fileStream.on('error', reject)
    })
    await client.end().catch(() => undefined)
  }

  const fileInfo = await stat(outPath)
  console.log(`\n完成：${rows} 条资产，原始 bytes 共 ${(totalBytes / 1024 / 1024).toFixed(2)} MB，`)
  console.log(`备份文件 ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB → ${outPath}`)
}

main().catch((error) => {
  console.error('备份失败：', error)
  process.exit(1)
})
