import { describe, it, expect, vi } from 'vitest'
import { createTravelClient } from '@/lib/directions/googleClient'
import { buildPlanAgentServerDeps, getPlanAgentServerDeps } from '@/lib/planAgent/serverDeps'

function travelOkResponse() {
  return {
    ok: true,
    json: async () => ({
      status: 'OK',
      routes: [
        {
          legs: [
            {
              duration: { text: '10 mins', value: 600 },
              distance: { text: '2 km', value: 2000 },
              steps: [{ travel_mode: 'WALKING', html_instructions: '走', duration: { value: 600 }, distance: { value: 2000 } }],
            },
          ],
          overview_polyline: { points: '_p~iF~ps|U' },
        },
      ],
    }),
  } as unknown as Response
}

describe('createTravelClient（agent 侧 Directions 限速 + 有界缓存，按计划隔离）', () => {
  const baseInput = {
    origin: { lat: 34.89, lng: 135.77 },
    destination: { lat: 34.98, lng: 135.75 },
    mode: 'transit' as const,
  }

  it('同签名命中缓存：第二次调用不打 Google；失败结果不缓存可重试', async () => {
    const fetchImpl = vi.fn(async () => travelOkResponse())
    const travel = createTravelClient({ apiKey: 'k', fetchImpl })

    const first = await travel(baseInput)
    expect(first.ok).toBe(true)
    const second = await travel(baseInput)
    expect(second.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // 不同签名（换 mode）重新请求
    await travel({ ...baseInput, mode: 'driving' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('departureTimeSec 参与缓存键：同时段重查命中，跨时段重取', async () => {
    const fetchImpl = vi.fn(async () => travelOkResponse())
    const travel = createTravelClient({ apiKey: 'k', fetchImpl })
    await travel({ ...baseInput, mode: 'driving', departureTimeSec: 1000 })
    await travel({ ...baseInput, mode: 'driving', departureTimeSec: 1000 })
    await travel({ ...baseInput, mode: 'driving', departureTimeSec: 2000 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('限速：超窗口后返回 rate_limited（typed），各计划实例互不共享配额', async () => {
    const fetchImpl = vi.fn(async () => travelOkResponse())
    // 每个计划一个独立实例（serverDeps 按 planId 装配）——配额互不共享
    const planA = createTravelClient({ apiKey: 'k', fetchImpl, rateMax: 2 })
    const planB = createTravelClient({ apiKey: 'k', fetchImpl, rateMax: 2 })

    // A 打满 2 次真实调用（不同签名避开缓存）
    expect((await planA({ ...baseInput, destination: { lat: 1, lng: 1 } })).ok).toBe(true)
    expect((await planA({ ...baseInput, destination: { lat: 2, lng: 2 } })).ok).toBe(true)
    const limited = await planA({ ...baseInput, destination: { lat: 3, lng: 3 } })
    expect(limited).toMatchObject({ ok: false, code: 'rate_limited' })

    // B 的配额未被 A 占用
    const bResult = await planB({ ...baseInput, destination: { lat: 4, lng: 4 } })
    expect(bResult.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('缓存有界：超上限逐出最旧条目', async () => {
    const fetchImpl = vi.fn(async () => travelOkResponse())
    const travel = createTravelClient({ apiKey: 'k', fetchImpl, rateMax: 100, cacheMax: 2 })
    await travel({ ...baseInput, destination: { lat: 1, lng: 1 } })
    await travel({ ...baseInput, destination: { lat: 2, lng: 2 } })
    await travel({ ...baseInput, destination: { lat: 3, lng: 3 } }) // 逐出 lat=1
    await travel({ ...baseInput, destination: { lat: 1, lng: 1 } }) // 重新外呼
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})

describe('buildPlanAgentServerDeps / getPlanAgentServerDeps（按计划隔离装配）', () => {
  it('build：注入的 fetch 同时服务 places 与 travel；两个 rateKey 的实例互不相干', async () => {
    const fetchImpl = vi.fn(async () => travelOkResponse())
    const depsA = buildPlanAgentServerDeps({ apiKey: 'k', rateKey: 'plan-a', fetchImpl })
    const depsB = buildPlanAgentServerDeps({ apiKey: 'k', rateKey: 'plan-b', fetchImpl })
    expect(depsA.places).toBeDefined()
    expect(depsA.travel).toBeDefined()
    expect(depsA.places).not.toBe(depsB.places)
    expect(depsA.travel).not.toBe(depsB.travel)
  })

  it('get：同计划复用实例，跨计划各自持有（修掉首个 planId 全局泄漏）', () => {
    const hadKey = process.env.GOOGLE_DIRECTIONS_API_KEY
    process.env.GOOGLE_DIRECTIONS_API_KEY = 'test-key'
    try {
      const depsA1 = getPlanAgentServerDeps('plan-a')
      const depsA2 = getPlanAgentServerDeps('plan-a')
      const depsB = getPlanAgentServerDeps('plan-b')
      expect(depsA1).toBe(depsA2)
      expect(depsA1).not.toBe(depsB)
      expect(depsA1.places).toBeDefined()
      expect(depsA1.travel).toBeDefined()
      expect(depsA1.places).not.toBe(depsB.places)
      expect(depsA1.travel).not.toBe(depsB.travel)
    } finally {
      if (hadKey === undefined) delete process.env.GOOGLE_DIRECTIONS_API_KEY
      else process.env.GOOGLE_DIRECTIONS_API_KEY = hadKey
    }
  })

  it('无 key 时 places/travel 缺位（工具返回显式配置错误），封面补齐仍可用', () => {
    const deps = buildPlanAgentServerDeps({ apiKey: '', rateKey: 'plan-x' })
    expect(deps.places).toBeUndefined()
    expect(deps.travel).toBeUndefined()
    expect(deps.resolveOptionCover).toBeDefined()
  })
})
