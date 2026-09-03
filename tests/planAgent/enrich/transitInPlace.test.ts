import { describe, it, expect, vi } from 'vitest'
import { runTransportEnricher } from '@/lib/planAgent/enrich/transportEnricher'
import { emptyEnrichReport } from '@/lib/planAgent/enrich/types'
import type { EnrichContext, EnrichDay } from '@/lib/planAgent/enrich/types'

/**
 * 回归第三轮 A4：相邻两坐标条目之间已存在 transit 行但 payload.transport 为空
 * （且不是 legacy 扁平载荷）时，对它就地查询并写入——不新插行、不重复。
 * A5：estimate+heuristic 的行视为"待升级"，下一回合有预算时被真实查询替换。
 */

const coords = new Map([
  ['p1', { lat: 34.8892, lng: 135.8075 }],
  ['p2', { lat: 34.8963, lng: 135.8123 }],
])

function travelOk() {
  return {
    ok: true as const,
    mode: 'walking' as const,
    legs: [],
    durationSeconds: 480,
    distanceMeters: 600,
    transfers: 0,
    walkSeconds: 480,
    transitSeconds: 0,
    polyline: [],
  }
}

function makeCtx(travel?: ReturnType<typeof vi.fn>, budget?: EnrichContext['budget']): EnrichContext {
  return {
    ...(travel ? { deps: { travel } } : { deps: {} }),
    coordsByPointId: coords,
    ...(budget ? { budget } : {}),
  }
}

describe('transportEnricher 就地补齐（A4）', () => {
  it('[A, transit(无载荷), B] → 该行就地写入 transport，行数不变', async () => {
    const travel = vi.fn(travelOk)
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          { type: 'transit', title: '宇治桥 → 大吉山' },
          { type: 'point', pointId: 'p2', title: '大吉山' },
        ],
      },
    ]
    const report = emptyEnrichReport()
    await runTransportEnricher(days, makeCtx(travel), report)
    expect(travel).toHaveBeenCalledTimes(1)
    expect(travel).toHaveBeenCalledWith(expect.objectContaining({ origin: { lat: 34.8892, lng: 135.8075 }, destination: { lat: 34.8963, lng: 135.8123 } }))
    expect(report.applied.transport).toBe(1)
    expect(days[0].items).toHaveLength(3)
    const transitRow = days[0].items[1]
    expect(transitRow.type).toBe('transit')
    expect((transitRow.payload as Record<string, unknown>).transport).toMatchObject({ provider: 'google', mode: 'walk' })
  })

  it('provider 空的不合格行同样就地补齐；legacy 扁平载荷不动', async () => {
    const travel = vi.fn(travelOk)
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          { type: 'transit', title: '无 provider 交通', payload: { transport: { mode: 'walk', durationMin: 8 } } },
          { type: 'point', pointId: 'p2', title: '大吉山' },
          { type: 'transit', title: 'legacy 扁平', payload: { mode: 'walk', durationMin: 10 } },
          { type: 'point', pointId: 'p1', title: '回程' },
        ],
      },
    ]
    const report = emptyEnrichReport()
    await runTransportEnricher(days, makeCtx(travel), report)
    expect(travel).toHaveBeenCalledTimes(1)
    expect(report.applied.transport).toBe(1)
    expect(days[0].items).toHaveLength(5)
    expect((days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'google' })
    // legacy 扁平载荷保持原样（不包一层 transport）
    expect((days[0].items[3].payload as Record<string, unknown>).transport).toBeUndefined()
    expect((days[0].items[3].payload as Record<string, unknown>).mode).toBe('walk')
  })

  it('estimate+heuristic 行视为待升级：有预算时被真实查询替换（A5）', async () => {
    const travel = vi.fn(travelOk)
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          {
            type: 'transit',
            title: '宇治桥 → 大吉山',
            payload: { transport: { mode: 'walk', durationMin: 12, provider: 'estimate', estimated: true, source: 'heuristic' } },
          },
          { type: 'point', pointId: 'p2', title: '大吉山' },
        ],
      },
    ]
    const report = emptyEnrichReport()
    await runTransportEnricher(days, makeCtx(travel), report)
    expect(travel).toHaveBeenCalledTimes(1)
    expect(report.applied.transport).toBe(1)
    expect(days[0].items).toHaveLength(3)
    expect((days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'google' })
  })

  it('两行 transit 夹在同一对坐标条目之间：只就地补第一行，不插新行', async () => {
    const travel = vi.fn(travelOk)
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          { type: 'transit', title: '第一段（无载荷）' },
          { type: 'transit', title: '第二段（无载荷）' },
          { type: 'point', pointId: 'p2', title: '大吉山' },
        ],
      },
    ]
    const report = emptyEnrichReport()
    await runTransportEnricher(days, makeCtx(travel), report)
    expect(days[0].items).toHaveLength(4)
    expect(travel).toHaveBeenCalledTimes(1)
    expect((days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'google' })
    expect(days[0].items[2].payload ?? null).toBeNull()
  })
})

describe('transportEnricher 零外呼估算兜底（A5）', () => {
  it('预算耗尽 → 不再留空：就地/插行写入直线距离估算（provider estimate + source heuristic + 深链）', async () => {
    const travel = vi.fn(travelOk)
    const budget = { directions: { used: 12, max: 12 }, places: { used: 0, max: 6 }, windowStartedAt: Date.now() }
    // 插行路径
    const insertDays: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          { type: 'point', pointId: 'p2', title: '大吉山' },
        ],
      },
    ]
    const insertReport = emptyEnrichReport()
    await runTransportEnricher(insertDays, makeCtx(travel, budget), insertReport)
    expect(travel).not.toHaveBeenCalled()
    expect(insertReport.applied.transport).toBe(1)
    expect(insertReport.skipped.filter((s) => s.reason === 'budget')).toHaveLength(0)
    const inserted = insertDays[0].items[1]
    expect(inserted.type).toBe('transit')
    const transport = (inserted.payload as Record<string, unknown>).transport as Record<string, unknown>
    expect(transport).toMatchObject({ provider: 'estimate', estimated: true, source: 'heuristic', mode: 'walk' })
    expect(String(transport.mapsUrl)).toContain('https://www.google.com/maps/dir/')
    // p1→p2 直线约 0.9km ≤ 1.5km → 步行
    expect(Number(transport.distanceKm)).toBeLessThanOrEqual(1.5)

    // 就地路径：无载荷 transit 行在预算耗尽时写入估算
    const inPlaceDays: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          { type: 'transit', title: '宇治桥 → 大吉山' },
          { type: 'point', pointId: 'p2', title: '大吉山' },
        ],
      },
    ]
    const inPlaceReport = emptyEnrichReport()
    await runTransportEnricher(inPlaceDays, makeCtx(travel, budget), inPlaceReport)
    expect(inPlaceDays[0].items).toHaveLength(3)
    expect((inPlaceDays[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({
      provider: 'estimate',
      source: 'heuristic',
    })
  })

  it('查询失败（zero_results）→ 写入估算行，不再只记 skipped', async () => {
    const travel = vi.fn(async () => ({ ok: false as const, code: 'zero_results' as const, message: '无路线' }))
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          { type: 'point', pointId: 'p2', title: '大吉山' },
        ],
      },
    ]
    const report = emptyEnrichReport()
    await runTransportEnricher(days, makeCtx(travel), report)
    expect(report.applied.transport).toBe(1)
    expect(days[0].items).toHaveLength(3)
    expect((days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'estimate', source: 'heuristic' })
  })

  it('travel 服务未配置 → 缺口全部写估算行（零外呼）', async () => {
    const days: EnrichDay[] = [
      {
        dayIndex: 1,
        citySlug: null,
        summary: null,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥' },
          { type: 'point', pointId: 'p2', title: '大吉山' },
        ],
      },
    ]
    const report = emptyEnrichReport()
    await runTransportEnricher(days, makeCtx(), report)
    expect(report.applied.transport).toBe(1)
    expect((days[0].items[1].payload as Record<string, unknown>).transport).toMatchObject({ provider: 'estimate', source: 'heuristic' })
  })
})
