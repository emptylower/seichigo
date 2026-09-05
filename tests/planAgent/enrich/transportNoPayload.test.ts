import { describe, it, expect, vi } from 'vitest'
import { runTransportEnricher } from '@/lib/planAgent/enrich/transportEnricher'
import { emptyEnrichReport } from '@/lib/planAgent/enrich/types'
import type { EnrichContext, EnrichDay } from '@/lib/planAgent/enrich/types'

/**
 * M4 修复 #9：queryTravelBetween 返回 ok 但缺 transportPayload（防御分支，
 * 当前实现的 ok 路径总是携带 payload）时记 skipped（reason 'no_payload'），
 * 不插行也不静默吞掉。用 vi.mock 复现该返回形态。
 */

const { queryTravelBetweenMock } = vi.hoisted(() => ({ queryTravelBetweenMock: vi.fn(async () => ({ ok: true, response: {} })) }))

vi.mock('@/lib/planAgent/travelQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/planAgent/travelQuery')>()
  return { ...actual, queryTravelBetween: queryTravelBetweenMock }
})

describe('transportEnricher no_payload 防御分支', () => {
  it('outcome.ok 但 response.transportPayload 缺失 → skipped（reason no_payload），不插行', async () => {
    queryTravelBetweenMock.mockResolvedValue({ ok: true, response: {} })
    const coords = new Map([
      ['p1', { lat: 34.8892, lng: 135.8075 }],
      ['p2', { lat: 34.8963, lng: 135.8123 }],
    ])
    const ctx: EnrichContext = {
      deps: { travel: vi.fn() },
      coordsByPointId: coords,
    }
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
    await runTransportEnricher(days, ctx, report)
    expect(queryTravelBetweenMock).toHaveBeenCalledTimes(1)
    expect(report.applied.transport).toBe(0)
    expect(days[0].items).toHaveLength(2)
    expect(report.skipped).toContainEqual(
      expect.objectContaining({ enricher: 'transport', itemTitle: '宇治桥 → 大吉山', reason: 'no_payload' }),
    )
  })
})
