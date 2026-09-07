import { describe, it, expect } from 'vitest'
import { MemoryBillingCheckoutIntentRepo } from '@/lib/billing/creem/repoMemory'

/** F2：付费意向 memory 仓储的 stats 聚合（total / last24h / byDay UTC） */

const NOW = new Date('2026-09-07T12:00:00Z')

function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 3_600_000)
}

function makeRepo(): MemoryBillingCheckoutIntentRepo {
  const repo = new MemoryBillingCheckoutIntentRepo()
  repo.seed({ userId: 'u1', tier: 'standard', source: 'pricing', locale: 'zh', gated: true, createdAt: hoursAgo(1) })
  repo.seed({ userId: null, tier: 'standard', source: 'hint', locale: 'en', gated: true, createdAt: hoursAgo(26) })
  repo.seed({ userId: 'u1', tier: 'standard', source: 'profile', locale: 'ja', gated: true, createdAt: new Date('2026-09-05T00:00:00Z') })
  repo.seed({ userId: 'u2', tier: 'standard', source: 'usage', locale: null, gated: false, createdAt: new Date('2026-09-01T00:00:00Z') })
  // 窗口外：只进 total
  repo.seed({ userId: 'u2', tier: 'standard', source: 'unknown', locale: null, gated: true, createdAt: new Date('2026-08-23T00:00:00Z') })
  repo.seed({ userId: 'u3', tier: 'standard', source: 'pricing', locale: null, gated: true, createdAt: new Date('2026-08-20T00:00:00Z') })
  return repo
}

describe('MemoryBillingCheckoutIntentRepo.stats', () => {
  it('total / last24h / last7d / uniqueUsers / anonymous', async () => {
    const stats = await makeRepo().stats(NOW)
    expect(stats.total).toBe(6)
    expect(stats.last24h).toBe(1)
    expect(stats.last7d).toBe(4)
    expect(stats.uniqueUsers).toBe(3)
    expect(stats.anonymous).toBe(1)
  })

  it('byDay 固定 14 天（UTC 日），升序，窗口外不计入', async () => {
    const stats = await makeRepo().stats(NOW)
    expect(stats.byDay).toHaveLength(14)
    expect(stats.byDay[0]?.day).toBe('2026-08-25')
    expect(stats.byDay[13]?.day).toBe('2026-09-07')
    const byDayMap = new Map(stats.byDay.map((d) => [d.day, d.count]))
    expect(byDayMap.get('2026-09-07')).toBe(1)
    expect(byDayMap.get('2026-09-06')).toBe(1)
    expect(byDayMap.get('2026-09-05')).toBe(1)
    expect(byDayMap.get('2026-09-01')).toBe(1)
    expect(byDayMap.get('2026-08-31')).toBe(0)
    expect(byDayMap.get('2026-08-25')).toBe(0)
  })

  it('空仓储全零', async () => {
    const stats = await new MemoryBillingCheckoutIntentRepo().stats(NOW)
    expect(stats).toEqual({
      total: 0,
      last24h: 0,
      last7d: 0,
      uniqueUsers: 0,
      anonymous: 0,
      byDay: Array.from({ length: 14 }, (_, i) => ({
        day: new Date(NOW.getTime() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
        count: 0,
      })),
    })
  })

  it('record 落一条完整字段（当前时间）', async () => {
    const repo = new MemoryBillingCheckoutIntentRepo()
    const before = Date.now()
    await repo.record({ userId: null, tier: 'standard', source: 'pricing', locale: 'zh', gated: true })
    const rows = repo.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: null, tier: 'standard', source: 'pricing', locale: 'zh', gated: true })
    expect(rows[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})
