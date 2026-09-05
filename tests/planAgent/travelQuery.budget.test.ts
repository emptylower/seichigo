import { describe, it, expect, vi } from 'vitest'
import { queryTravelBetween } from '@/lib/planAgent/travelQuery'
import { createEnrichBudget } from '@/lib/planAgent/enrich/types'
import type { TravelResult } from '@/lib/directions/googleClient'

/**
 * M4 修复 #2：预算按真实外呼计数。queryTravelBetween 的 onGoogleCall 在每次
 * 真实 Google 调用（主查询 + 日本兜底的 driving/walking 补查）之前回调一次，
 * 抛错路径同样已计数（先计数再 await）。
 */

const shinjuku = { lat: 35.6938, lng: 139.7034 }
const shinjukuWest = { lat: 35.7015, lng: 139.7102 }

const ZERO_RESULTS: TravelResult = {
  ok: false,
  code: 'zero_results',
  message: '该路段没有查到可用的公共交通路线',
}

function travelOk(mode: 'driving' | 'walking', durationSeconds: number, distanceMeters: number): TravelResult {
  return {
    ok: true,
    mode,
    legs: [],
    durationSeconds,
    distanceMeters,
    transfers: 0,
    walkSeconds: mode === 'walking' ? durationSeconds : 0,
    transitSeconds: 0,
    polyline: [],
  }
}

describe('queryTravelBetween onGoogleCall 计数', () => {
  it('日本兜底一次 queryTravelBetween：transit + driving + walking 三次真实外呼各回调一次', async () => {
    const travel = vi.fn(async (input: { mode: string }) => {
      if (input.mode === 'transit') return ZERO_RESULTS
      if (input.mode === 'driving') return travelOk('driving', 5 * 60, 1_200)
      return travelOk('walking', 16 * 60, 1_200)
    })
    const budget = createEnrichBudget()
    const outcome = await queryTravelBetween(
      {
        travel: travel as unknown as Parameters<typeof queryTravelBetween>[0]['travel'],
        onGoogleCall: () => {
          budget.directions.used += 1
        },
      },
      { from: shinjuku, to: shinjukuWest, mode: 'transit' },
    )
    expect(outcome.ok).toBe(true)
    expect(budget.directions.used).toBe(3)
    expect(travel).toHaveBeenCalledTimes(3)
  })

  it('日本兜底走估算分支（driving 距离 > 1.5km）：transit + driving 共 2 次外呼', async () => {
    const travel = vi.fn(async (input: { mode: string }) => {
      if (input.mode === 'transit') return ZERO_RESULTS
      return travelOk('driving', 25 * 60, 20_000)
    })
    const budget = createEnrichBudget()
    const outcome = await queryTravelBetween(
      {
        travel: travel as unknown as Parameters<typeof queryTravelBetween>[0]['travel'],
        onGoogleCall: () => {
          budget.directions.used += 1
        },
      },
      { from: shinjuku, to: { lat: 35.5108, lng: 138.7572 }, mode: 'transit' },
    )
    expect(outcome.ok).toBe(true)
    expect(budget.directions.used).toBe(2)
  })

  it('普通单次查询只计 1；travel 抛错同样已计数（先计数再 await）', async () => {
    const budget = createEnrichBudget()
    const onGoogleCall = () => {
      budget.directions.used += 1
    }
    const travel = vi.fn(async () => travelOk('walking', 10 * 60, 800))
    await queryTravelBetween(
      { travel: travel as unknown as Parameters<typeof queryTravelBetween>[0]['travel'], onGoogleCall },
      { from: shinjuku, to: shinjukuWest, mode: 'walk' },
    )
    expect(budget.directions.used).toBe(1)

    const throwing = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(
      queryTravelBetween(
        { travel: throwing as unknown as Parameters<typeof queryTravelBetween>[0]['travel'], onGoogleCall },
        { from: shinjuku, to: shinjukuWest, mode: 'walk' },
      ),
    ).rejects.toThrow('network down')
    expect(budget.directions.used).toBe(2)
  })

  it('R3 上调后默认预算：directions.max=40、places.max=40（模型各留 10 预留）；低于 60/分钟限速窗口', () => {
    const budget = createEnrichBudget()
    expect(budget.directions).toEqual({ used: 0, max: 40 })
    expect(budget.places).toEqual({ used: 0, max: 40, reserved: 0 })
  })
})
