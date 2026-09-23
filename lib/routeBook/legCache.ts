import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// ---------------------------------------------------------------------------
// RouteLegCache 表的通用 key-value 缓存（B1.1 A1 起用；B2 段级 Google 缓存复用）。
// 尽力而为：任何库错误都按未命中/写入失败处理，绝不打断调用方。
// ---------------------------------------------------------------------------

export const LEG_CACHE_DEFAULT_TTL_DAYS = 7

export function routeLegCacheKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** 命中且未过期返回 payload；过期视为未命中并异步清理 */
export async function getCachedRoutePayload(key: string): Promise<Prisma.JsonValue | null> {
  try {
    const row = await prisma.routeLegCache.findUnique({ where: { key } })
    if (!row) return null
    if (row.expiresAt.getTime() <= Date.now()) {
      void prisma.routeLegCache.delete({ where: { key } }).catch(() => undefined)
      return null
    }
    return row.payload
  } catch {
    return null
  }
}

export async function setCachedRoutePayload(
  key: string,
  payload: Prisma.InputJsonValue,
  ttlDays: number = LEG_CACHE_DEFAULT_TTL_DAYS,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
    await prisma.routeLegCache.upsert({
      where: { key },
      create: { key, payload, expiresAt },
      update: { payload, expiresAt },
    })
  } catch {
    // 缓存写失败不影响主流程
  }
}
