/**
 * 镜像状态表的一次性清理：
 *  ① 删除全部 `variant = 'h320'` 行 —— 该变体上游不存在（EdgeOne 404），
 *     5 月全量镜像时 41,668 条被错误记成 skipped_404/failed；
 *  ② 把 `status = 'failed'` 且 lastError 含 `upstream 403`（canonical host 被 WAF 拒绝）
 *     的行重置为 pending，等 seed 走投递域重跑。
 *
 * Prisma 的 deleteMany/updateMany 不支持 LIMIT，因此用 ctid 子查询分批
 * （每批 5,000，循环直到不足一批），避免单条 SQL 删/改数万行造成长事务超时。
 */

const MIRROR_CLEANUP_BATCH_SIZE = 5_000

export type MirrorCleanupPrisma = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>
}

export type MirrorCleanupResult = {
  deletedH320: number
  resetFailed: number
}

async function runBatched(prisma: MirrorCleanupPrisma, runBatch: (prisma: MirrorCleanupPrisma) => Promise<number>): Promise<number> {
  let total = 0

  while (true) {
    const affected = await runBatch(prisma)
    total += affected
    if (affected < MIRROR_CLEANUP_BATCH_SIZE) {
      return total
    }
  }
}

export async function cleanupObsoleteMirrorState(prisma: MirrorCleanupPrisma): Promise<MirrorCleanupResult> {
  const deletedH320 = await runBatched(prisma, async (client) =>
    client.$executeRaw`
      DELETE FROM "MapImageMirrorState"
      WHERE ctid IN (
        SELECT ctid FROM "MapImageMirrorState"
        WHERE "variant" = 'h320'
        LIMIT ${MIRROR_CLEANUP_BATCH_SIZE}
      )
    `)

  const resetFailed = await runBatched(prisma, async (client) =>
    client.$executeRaw`
      UPDATE "MapImageMirrorState"
      SET "status" = 'pending', "attempts" = 0, "lastError" = NULL
      WHERE ctid IN (
        SELECT ctid FROM "MapImageMirrorState"
        WHERE "status" = 'failed' AND "lastError" LIKE '%upstream 403%'
        LIMIT ${MIRROR_CLEANUP_BATCH_SIZE}
      )
    `)

  return { deletedH320, resetFailed }
}
