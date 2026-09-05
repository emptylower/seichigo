import { describe, it, expect, vi } from 'vitest'
import { queryTravelBetween, summarizeLegForModel } from '@/lib/planAgent/travelQuery'
import type { TravelResult } from '@/lib/directions/googleClient'
/**
 * 第七轮 A3：交通载荷补充字段——legs[i].headsign 透传、transport.source
 * 标注（google / japan-fallback / heuristic），供前端交通详情抽屉使用。
 */

const shinjuku = { lat: 35.6938, lng: 139.7034 }
const kawaguchiko = { lat: 35.5108, lng: 138.7572 }

const ZERO_RESULTS: TravelResult = {
  ok: false,
  code: 'zero_results',
  message: '该路段没有查到可用的公共交通路线',
}

function transitTravelOk(): Extract<TravelResult, { ok: true }> {
  return {
    ok: true,
    mode: 'transit',
    legs: [
      {
        startAddress: '新宿站',
        endAddress: '河口湖站',
        duration: '100 分',
        durationSeconds: 6_000,
        distance: '100 km',
        distanceMeters: 100_000,
        steps: [
          {
            travelMode: 'WALKING',
            instruction: '步行至新宿高速巴士总站',
            duration: '5 分',
            durationSeconds: 300,
            distance: '400 m',
            distanceMeters: 400,
            transitDetails: null,
          },
          {
            travelMode: 'TRANSIT',
            instruction: '乘坐高速巴士前往河口湖',
            duration: '95 分',
            durationSeconds: 5_700,
            distance: '99.6 km',
            distanceMeters: 99_600,
            transitDetails: {
              lineName: '高速巴士 富士急行',
              departureStop: 'バスタ新宿',
              arrivalStop: '河口湖駅',
              numStops: 6,
              departureTime: '09:12',
              arrivalTime: '10:47',
              headsign: '河口湖',
            },
          },
        ],
      },
    ],
    durationSeconds: 6_000,
    distanceMeters: 100_000,
    transfers: 0,
    walkSeconds: 300,
    transitSeconds: 5_700,
    polyline: [],
  }
}

describe('summarizeLegForModel headsign 透传', () => {
  it('transitDetails.headsign 存在时写入 legs[i].headsign；缺失时不出现该键', () => {
    const [walkLeg, transitLeg] = transitTravelOk().legs[0]!.steps.map(summarizeLegForModel)
    expect(walkLeg).not.toHaveProperty('headsign')
    expect(transitLeg).toMatchObject({
      mode: 'transit',
      line: '高速巴士 富士急行',
      headsign: '河口湖',
      fromStop: 'バスタ新宿',
      toStop: '河口湖駅',
      numStops: 6,
      departureTime: '09:12',
      arrivalTime: '10:47',
    })
  })
})

describe('queryTravelBetween source 标注', () => {
  it('真实 Google 路线：transportPayload.source = google，legs 含 headsign', async () => {
    const travel = vi.fn(async () => transitTravelOk())
    const outcome = await queryTravelBetween(
      { travel: travel as unknown as Parameters<typeof queryTravelBetween>[0]['travel'] },
      { from: shinjuku, to: kawaguchiko, mode: 'transit' },
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.source).toBe('google')
    const payload = outcome.response.transportPayload as { source?: string; legs?: Array<{ headsign?: string }> }
    expect(payload.source).toBe('google')
    expect(payload.legs?.[1]?.headsign).toBe('河口湖')
  })

  it('日本公交兜底估算：source = japan-fallback（响应与 transportPayload 同步标注）', async () => {
    const travel = vi.fn(async (input: { mode: string }) => {
      if (input.mode === 'transit') return ZERO_RESULTS
      return {
        ok: true as const,
        mode: 'driving' as const,
        legs: [],
        durationSeconds: 25 * 60,
        distanceMeters: 20_000,
        transfers: 0,
        walkSeconds: 0,
        transitSeconds: 0,
        polyline: [],
      }
    })
    const outcome = await queryTravelBetween(
      { travel: travel as unknown as Parameters<typeof queryTravelBetween>[0]['travel'] },
      { from: shinjuku, to: kawaguchiko, mode: 'transit' },
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.response.source).toBe('japan-fallback')
    expect((outcome.response.transportPayload as { source?: string }).source).toBe('japan-fallback')
  })
})
