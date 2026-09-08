/**
 * 2026-09-08 图片资产迁 R2：从 backup-assets.mts 的 NDJSON.gz 备份恢复 Asset 表。
 *
 *   npx tsx scripts/restore-assets.mts --file ~/Backups/seichigo/assets-<ISO>.ndjson.gz --yes
 *   npx tsx scripts/restore-assets.mts --file <path> --only-missing --yes
 *   npx tsx scripts/restore-assets.mts --help
 *
 * 默认 UPSERT（ON CONFLICT (id) DO UPDATE，覆盖 bytes 及 R2 元数据列）；
 * --only-missing 只补缺（ON CONFLICT DO NOTHING）。逐行流式解压解析，
 * 不会把整个备份读进内存。默认干跑：打印目标 host，必须 --yes 才执行。
 */
import { createGunzip } from 'node:zlib'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import pg from 'pg'

const argv = process.argv.slice(2)

const USAGE = `Usage: npx tsx scripts/restore-assets.mts --file <path.ndjson.gz> [--only-missing] --yes

  --file <path>   备份文件（backup-assets.mts 产出的 .ndjson.gz，必填）
  --only-missing  只插入缺失的 id，不覆盖已有行
  --yes           真正执行写入（默认干跑）
  --help          显示本说明`

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE)
  process.exit(0)
}

function flagValue(name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1]
  const prefix = `${name}=`
  const hit = argv.find((arg) => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

function dbHost(dbUrl: string): string {
  try {
    return new URL(dbUrl).host
  } catch {
    return '(无法解析 host)'
  }
}

type BackupRow = {
  id: string
  ownerId: string
  contentType: string
  filename: string | null
  bytes: string
  storageKey: string | null
  byteLength: number | null
  width: number | null
  height: number | null
  createdAt: string
}

async function main() {
  const filePath = flagValue('--file')
  if (!filePath) {
    console.error('缺少 --file <path>。--help 查看用法。')
    process.exit(1)
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL 未设置。请先 export（注意区分 dev 库与生产库）。')
    process.exit(1)
  }

  const host = dbHost(dbUrl)
  const onlyMissing = argv.includes('--only-missing')
  console.log(`目标数据库 host: ${host}`)
  console.log(`备份文件: ${filePath}`)
  console.log(`模式: ${onlyMissing ? '只补缺（DO NOTHING）' : 'UPSERT（覆盖 bytes/R2 元数据）'}`)

  if (!argv.includes('--yes')) {
    console.error('\n干跑模式：未执行任何写入。确认无误后加 --yes 重跑。')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()

  let inserted = 0
  let skipped = 0
  let failed = 0

  try {
    const gunzip = createGunzip()
    const lineReader = createInterface({ input: createReadStream(filePath).pipe(gunzip) })

    const conflictClause = onlyMissing
      ? 'ON CONFLICT (id) DO NOTHING'
      : `ON CONFLICT (id) DO UPDATE SET
        "ownerId" = EXCLUDED."ownerId",
        "contentType" = EXCLUDED."contentType",
        filename = EXCLUDED.filename,
        bytes = EXCLUDED.bytes,
        "storageKey" = EXCLUDED."storageKey",
        "byteLength" = EXCLUDED."byteLength",
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        "createdAt" = EXCLUDED."createdAt"`

    for await (const line of lineReader) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let row: BackupRow
      try {
        row = JSON.parse(trimmed) as BackupRow
      } catch {
        failed++
        console.error(`跳过无法解析的行：${trimmed.slice(0, 80)}…`)
        continue
      }
      try {
        const result = await client.query(
          `INSERT INTO "Asset" (id, "ownerId", "contentType", filename, bytes, "storageKey", "byteLength", width, height, "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ${conflictClause}`,
          [
            row.id,
            row.ownerId,
            row.contentType,
            row.filename,
            Buffer.from(row.bytes, 'base64'),
            row.storageKey,
            row.byteLength,
            row.width,
            row.height,
            new Date(row.createdAt),
          ],
        )
        if (result.rowCount && result.rowCount > 0) inserted++
        else skipped++
      } catch (error) {
        failed++
        console.error(`写入失败 id=${row.id}:`, error instanceof Error ? error.message : String(error))
      }
    }
  } finally {
    await client.end().catch(() => undefined)
  }

  console.log(`\n完成：写入/更新 ${inserted} 条，跳过（已存在）${skipped} 条，失败 ${failed} 条。`)
}

main().catch((error) => {
  console.error('恢复失败：', error)
  process.exit(1)
})
