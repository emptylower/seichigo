import { utcDateStamp } from '@/lib/share/ipHash'
import { readAllText, type ShareStore } from '@/lib/share/store'

/** 匿名每 IP 每日 300 次卡片渲染请求；缓存命中不计入 */
export const ANON_DAILY_CARD_LIMIT = 300

/** 全局每日 Browser Run 渲染上限；套餐额度约 2.4 万次/月，这条只是防跑飞 */
export const DAILY_RENDER_BUDGET = 3000

type RateEntry = { day: string; count: number }
const rateCounters = new Map<string, RateEntry>()

/**
 * 与 lib/share/handlers/pointContext.ts:34-51 同一套 isolate 内计数：
 * wrangler 里没有 KV 绑定，这条路由也不落请求行，只能这么数。
 * 多 isolate 下实际上限会被放大，但只有缓存未命中才走到这里，
 * 而未命中一次就会写 R2 缓存，滥用面被缓存钉死。
 */
export function checkCardRate(ipHash: string, now: Date): boolean {
  const day = utcDateStamp(now)
  const entry = rateCounters.get(ipHash)
  if (!entry || entry.day !== day) {
    // 跨日顺手清理，防止长尾 IP 把 Map 无限撑大（同 pointContext）
    if (rateCounters.size > 5000) {
      for (const [key, value] of rateCounters) {
        if (value.day !== day) rateCounters.delete(key)
      }
    }
    rateCounters.set(ipHash, { day, count: 1 })
    return true
  }
  if (entry.count >= ANON_DAILY_CARD_LIMIT) return false
  entry.count += 1
  return true
}

/** 单测隔离用 */
export function resetCardRate(): void {
  rateCounters.clear()
}

/**
 * 日计数对象：R2 没有对象级 TTL，跨日对象不会自动消失——要清理得靠桶的
 * lifecycle 规则，或者干脆不清（一年 365 个小 JSON 对象，可忽略）。
 */
export function cardBudgetKey(now: Date): string {
  return `og-cards/_budget/${utcDateStamp(now)}.json`
}

/**
 * 当日已渲染次数。选 R2 而不是 isolate 内计数：isolate 内计数在多 isolate 下
 * 完全失效，而这条是全局预算。读-改-写在并发下会少计（两个请求读到同一个值），
 * 作为「防跑飞」护栏可以接受——真正的成本上限由 Workers Paid 的浏览器时长兜底。
 */
export async function readRenderBudget(store: ShareStore, now: Date): Promise<number> {
  try {
    const object = await store.get(cardBudgetKey(now))
    if (!object) return 0
    const parsed = JSON.parse(await readAllText(object.body)) as { count?: unknown }
    const count = Number(parsed?.count)
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  } catch {
    return 0
  }
}

export async function bumpRenderBudget(store: ShareStore, now: Date): Promise<void> {
  const next = (await readRenderBudget(store, now)) + 1
  const bytes = new TextEncoder().encode(JSON.stringify({ count: next }))
  await store.put(cardBudgetKey(now), bytes, 'application/json')
}
