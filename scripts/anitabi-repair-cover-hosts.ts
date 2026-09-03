import { prisma } from '@/lib/db/prisma'
import { computeCanonicalImageUrl, normalizeBgmApiRelayUrl } from '@/lib/anitabi/imageNormalize'
import { reconcileMirrorAfterDiff } from '@/lib/anitabi/sync/mirrorReconcile'
import type { MirrorDiffChange } from '@/lib/anitabi/sync/mirrorReconcile'

/**
 * 修复 2026-08-31 anitabi bulk 同步事故写坏的封面 host：
 *   https://bgm-api.anitabi.cn/...  → 用 normalizeBgmApiRelayUrl 归一回 lain.bgm.tv（该中转域全线 403）
 *   https://www.anitabi.cn/...      → 按现有 canonical 规则归一（host → image.anitabi.cn、/images/ 前缀去掉）
 *
 * 修复后调用 reconcileMirrorAfterDiff 把 mapImageMirrorState 重新指向正确 canonical，
 * 让 R2 兜底与 mirror worker 恢复有效（key 与旧镜像零漂移）。
 *
 * 运行：npm run anitabi:repair-covers [-- --dry-run]
 */

const BGM_API_COVER_PREFIX = 'https://bgm-api.anitabi.cn'
const WWW_ANITABI_COVER_PREFIX = 'https://www.anitabi.cn'

function repairCoverValue(oldValue: string): string | null {
  if (oldValue.startsWith(BGM_API_COVER_PREFIX)) {
    return normalizeBgmApiRelayUrl(oldValue).toString()
  }
  if (oldValue.startsWith(WWW_ANITABI_COVER_PREFIX)) {
    return computeCanonicalImageUrl(oldValue)
  }
  return null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const rows = await prisma.anitabiBangumi.findMany({
    where: {
      OR: [
        { cover: { startsWith: BGM_API_COVER_PREFIX } },
        { cover: { startsWith: WWW_ANITABI_COVER_PREFIX } },
      ],
    },
    select: { id: true, cover: true },
    orderBy: { id: 'asc' },
  })

  const changes: MirrorDiffChange[] = []
  for (const row of rows) {
    const oldValue = row.cover
    if (!oldValue) continue
    const newValue = repairCoverValue(oldValue)
    if (!newValue || newValue === oldValue) continue
    changes.push({ id: row.id, field: 'cover', oldValue, newValue })
  }

  if (dryRun) {
    console.log(`[anitabi-repair-covers] dry-run: ${changes.length} cover(s) would be updated`)
    for (const change of changes.slice(0, 20)) {
      console.log(`  #${change.id}: ${change.oldValue} -> ${change.newValue}`)
    }
    if (changes.length > 20) {
      console.log(`  ... and ${changes.length - 20} more`)
    }
    return
  }

  for (const change of changes) {
    await prisma.anitabiBangumi.update({
      where: { id: change.id as number },
      data: { cover: change.newValue },
    })
  }
  console.log(`[anitabi-repair-covers] updated ${changes.length} cover(s)`)

  await reconcileMirrorAfterDiff(prisma, { bangumiChanges: changes, pointChanges: [] })
  console.log('[anitabi-repair-covers] mirror state reconciled')
}

main().catch((err) => {
  console.error('[scripts/anitabi-repair-cover-hosts] failed', err)
  process.exit(1)
})
