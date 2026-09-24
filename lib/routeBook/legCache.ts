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

/**
 * 批量读段缓存（B2 A2：legs handler 一次往返读全天段）：一次 findMany；
 * 过期条目视为未命中并异步清理；库错误按全未命中处理。
 * 返回 Map<key, payload>（未命中的 key 不在 Map 里）。
 */
export async function getCachedLegs(keys: string[]): Promise<Map<string, Prisma.JsonValue>> {
  const out = new Map<string, Prisma.JsonValue>()
  if (keys.length === 0) return out
  try {
    const rows = await prisma.routeLegCache.findMany({ where: { key: { in: keys } } })
    const now = Date.now()
    for (const row of rows) {
      if (row.expiresAt.getTime() <= now) {
        void prisma.routeLegCache.deleteMany({ where: { key: row.key } }).catch(() => undefined)
        continue
      }
      out.set(row.key, row.payload)
    }
  } catch {
    // 库不可用按全未命中处理
  }
  return out
}

/** 写段缓存（legs 域命名入口；TTL 默认 7 天） */
export function setCachedLeg(
  key: string,
  payload: Prisma.InputJsonValue,
  ttlDays: number = LEG_CACHE_DEFAULT_TTL_DAYS,
): Promise<void> {
  return setCachedRoutePayload(key, payload, ttlDays)
}
