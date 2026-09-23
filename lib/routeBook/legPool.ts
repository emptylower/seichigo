import type { Prisma } from '@prisma/client'
import { getCachedLegs, routeLegCacheKey } from './legCache'
import { googleLegCacheRawKey, readCachedGoogleLegPayload } from './legResolverGoogle'
import type { Leg, LegResolver, LegStop } from './legs'
import type { TravelMode } from './repo'

// ---------------------------------------------------------------------------
// 段解析池（B2 A2）：legs handler 用。流程：
//   1. 先 getCachedLegs 一次往返批量读当天全部段的缓存（库错误按全未命中）；
//   2. 未命中的段经信号量并发 4 调上游 resolver；
//   3. 整池 8 秒截止（从创建时刻起算），排队等到已超时 / 单段超时的段返回
//      null，由 resolveDayLegs 降级 heuristic。
// 同一 (mode, from, to) 的重复请求去重（memo）。
// ---------------------------------------------------------------------------

const LEG_POOL_CONCURRENCY = 4
const LEG_POOL_DEADLINE_MS = 8_000

type ResolvedLeg = Omit<Leg, 'fromId' | 'toId' | 'mode'>

export type LegPoolOptions = { concurrency?: number; deadlineMs?: number }

/** 池句柄：resolve 供 resolveDayLegs 调用；isCached 供 handler 判断
 *  「该 raw key 是否已批量读命中」（限流只计真正会外呼的段）。 */
export type LegPool = {
  resolve: LegResolver
  isCached: (raw: string) => boolean
}

export async function createLegPoolResolver(
  resolver: LegResolver,
  stops: LegStop[],
  defaultMode: TravelMode,
  opts?: LegPoolOptions
): Promise<LegPool> {
  const concurrency = opts?.concurrency ?? LEG_POOL_CONCURRENCY
  const deadlineMs = opts?.deadlineMs ?? LEG_POOL_DEADLINE_MS

  // 1. 相邻停靠对的缓存 key（agent 段也会多读一条，无害）
  const hashedByRaw = new Map<string, string>()
  for (let i = 0; i + 1 < stops.length; i++) {
    const from = stops[i]!
    const to = stops[i + 1]!
    const raw = googleLegCacheRawKey(to.legMode ?? defaultMode, from, to)
    if (!hashedByRaw.has(raw)) hashedByRaw.set(raw, routeLegCacheKey(raw))
  }

  // 2. 批量读缓存（失败按全未命中）
  const cachedRows = await getCachedLegs([...hashedByRaw.values()])
  const cachedByRaw = new Map<string, ResolvedLeg>()
  for (const [raw, hashedKey] of hashedByRaw) {
    const payload: Prisma.JsonValue | undefined = cachedRows.get(hashedKey)
    if (payload === undefined) continue
    const read = readCachedGoogleLegPayload(payload)
    if (read) cachedByRaw.set(raw, read)
  }

  // 3. 信号量 + 截止
  const startAt = Date.now()
  const memo = new Map<string, Promise<ResolvedLeg | null>>()
  let active = 0
  const waiters: Array<() => void> = []

  function acquireSlot(): Promise<void> {
    if (active < concurrency) {
      active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        active++
        resolve()
      })
    })
  }

  function releaseSlot(): void {
    active--
    const next = waiters.shift()
    if (next) next()
  }

  return {
    resolve: (from, to, mode) => {
      const raw = googleLegCacheRawKey(mode, from, to)
      const existing = memo.get(raw)
      if (existing) return existing

      const cachedHit = cachedByRaw.get(raw)
      const task: Promise<ResolvedLeg | null> = cachedHit
        ? Promise.resolve(cachedHit)
        : (async () => {
            await acquireSlot()
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              const remaining = deadlineMs - (Date.now() - startAt)
              if (remaining <= 0) return null
              const timeout = new Promise<null>((resolveNull) => {
                timer = setTimeout(() => resolveNull(null), remaining)
              })
              try {
                // B2 修复 A4：池已批量读过缓存，上游跳过逐段读
                return await Promise.race([resolver(from, to, mode, { skipCacheRead: true }), timeout])
              } catch {
                return null
              }
            } finally {
              if (timer !== undefined) clearTimeout(timer)
              releaseSlot()
            }
          })()

      memo.set(raw, task)
      return task
    },
    isCached: (raw) => cachedByRaw.has(raw),
  }
}
