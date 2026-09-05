import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import type { TravelResult } from '@/lib/directions/googleClient'

/**
 * A1 日本公交覆盖缺口兜底：Google Directions 不提供日本公共交通数据，
 * transit ZERO_RESULTS 且起终点都在日本时按道路距离推算参考值，
 * 不再把 zero_results 抛回给模型去问用户。
 */

const shinjuku = { lat: 35.6938, lng: 139.7034 }
const kawaguchiko = { lat: 35.5108, lng: 138.7572 }
const londonA = { lat: 51.5074, lng: -0.1278 }
const londonB = { lat: 51.5155, lng: -0.0922 }

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

async function makeDeps(travel: PlanAgentToolDeps['travel']) {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const deps: PlanAgentToolDeps = { planId: plan.id, repo, points: {
    async searchBangumi() {
      return []
    },
    async countPointsByBangumi() {
      return []
    },
    async listPoints() {
      return []
    },
    async getPointsByIds() {
      return []
    },
  }, travel }
  return { deps }
}

describe('estimate_travel 日本公交兜底（A1）', () => {
  it('transit ZERO_RESULTS + 起终点在日本 + 自驾 20km/25min → estimated 参考值（含 mapsUrl/note/transportPayload）', async () => {
    const travel = vi.fn(async (input: { mode: string }) => {
      if (input.mode === 'transit') return ZERO_RESULTS
      // 25 min / 20 km 自驾
      return travelOk('driving', 25 * 60, 20_000)
    })
    const { deps } = await makeDeps(travel as PlanAgentToolDeps['travel'])

    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: shinjuku,
        to: kawaguchiko,
        mode: 'transit',
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.estimated).toBe(true)
    expect(out.provider).toBe('estimate')
    expect(out.mode).toBe('transit')
    // durationMin = round(25 × 1.3 + 12) = round(44.5) = 45
    expect(out.durationMin).toBe(45)
    expect(out.distanceKm).toBe(20)
    expect(out.transfers).toBeNull()
    expect(out.legs).toEqual([])
    expect(out.note).toContain('日本')
    expect(out.note).toContain('参考')
    expect(out.mapsUrl).toBe(
      `https://www.google.com/maps/dir/?api=1&origin=${shinjuku.lat},${shinjuku.lng}&destination=${kawaguchiko.lat},${kawaguchiko.lng}&travelmode=transit`,
    )
    expect(out.transportPayload).toMatchObject({
      mode: 'transit',
      durationMin: 45,
      distanceKm: 20,
      transfers: null,
      provider: 'estimate',
      estimated: true,
    })
    expect((out.transportPayload as { mapsUrl?: string }).mapsUrl).toBe(out.mapsUrl)
    // 兜底链路：先 transit 后 driving
    expect(travel.mock.calls.map(([input]) => (input as { mode: string }).mode)).toEqual(['transit', 'driving'])
  })

  it('自驾距离 ≤ 1.5km → 直接返回步行查询结果（provider google，非估算）', async () => {
    const travel = vi.fn(async (input: { mode: string }) => {
      if (input.mode === 'transit') return ZERO_RESULTS
      if (input.mode === 'driving') return travelOk('driving', 5 * 60, 1_200)
      return travelOk('walking', 16 * 60, 1_200)
    })
    const { deps } = await makeDeps(travel as PlanAgentToolDeps['travel'])

    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: shinjuku,
        to: { lat: 35.7015, lng: 139.7102 },
        mode: 'transit',
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.estimated).toBeUndefined()
    expect(out.mode).toBe('walk')
    expect(out.transportPayload).toMatchObject({ mode: 'walk', durationMin: 16, provider: 'google' })
    expect(travel.mock.calls.map(([input]) => (input as { mode: string }).mode)).toEqual(['transit', 'driving', 'walking'])
  })

  it('起终点不在日本（伦敦）→ 保持 zero_results + ask_user 引导，不再查自驾', async () => {
    const travel = vi.fn(async (input: { mode: string }) => {
      if (input.mode === 'transit') return ZERO_RESULTS
      return travelOk('driving', 10 * 60, 3_000)
    })
    const { deps } = await makeDeps(travel as PlanAgentToolDeps['travel'])

    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: londonA,
        to: londonB,
        mode: 'transit',
      }),
    )
    expect(out.ok).toBeUndefined()
    expect(out.code).toBe('zero_results')
    expect(out.hint).toContain('ask_user')
    expect(out.error).toContain('公共交通')
    expect(travel).toHaveBeenCalledTimes(1)
  })

  it('兜底自驾查询失败（如限速）→ 回退原 zero_results 错误行为', async () => {
    const travel = vi.fn(async (input: { mode: string }) => {
      if (input.mode === 'transit') return ZERO_RESULTS
      return { ok: false, code: 'rate_limited', message: '本计划的交通查询过于频繁，请稍后再试' } as TravelResult
    })
    const { deps } = await makeDeps(travel as PlanAgentToolDeps['travel'])

    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: shinjuku,
        to: kawaguchiko,
        mode: 'transit',
      }),
    )
    expect(out.code).toBe('zero_results')
    expect(out.hint).toContain('ask_user')
  })
})
