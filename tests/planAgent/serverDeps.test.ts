import { describe, it, expect, vi } from 'vitest'
import { createTravelClient } from '@/lib/directions/googleClient'
import { buildPlanAgentServerDeps, getPlanAgentServerDeps } from '@/lib/planAgent/serverDeps'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'

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

  it('F7：fetchPlacePhotos 的 onGoogleCall 透传到 photoMirror（真实外呼前恰好一次）', async () => {
    const onGoogleCall = vi.fn()
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          status: 'OK',
          result: { photos: [{ photo_reference: 'Aref_f7_passthrough', html_attributions: [] }] },
        }),
      }) as unknown as Response,
    )
    const deps = buildPlanAgentServerDeps({ apiKey: 'k', rateKey: 'plan-f7', fetchImpl })

    const photos = await deps.fetchPlacePhotos!({ placeId: 'ChIJ_f7', onGoogleCall })

    expect(photos).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // 计数与真实外呼绑定：恰好一次，且先于 fetch 发起
    expect(onGoogleCall).toHaveBeenCalledTimes(1)
    expect(onGoogleCall.mock.invocationCallOrder[0]).toBeLessThan(fetchImpl.mock.invocationCallOrder[0])
  })

  it('地点库修订：注入 store 后库命中不打网络（内存 → 库 → Google 阶梯生效）', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(
      {
        provider: 'google',
        placeId: 'ChIJ_disney',
        name: '東京ディズニーランド',
        address: null,
        lat: 35.6329,
        lng: 139.8804,
        mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_disney',
        photo: null,
        fetchedAt: new Date().toISOString(),
      },
      '东京迪士尼',
    )
    const fetchImpl = vi.fn(async () => travelOkResponse())
    const deps = buildPlanAgentServerDeps({ apiKey: 'k', rateKey: 'plan-store', fetchImpl, placeStore: store })
    const res = await deps.places!.resolveByText('东京迪士尼')
    expect(res).toMatchObject({ ok: true, fromCache: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('地点库修订：首次解析触发 onResolved → 后台镜像（waitUntil 派发，R2 canonical 无密钥）', async () => {
    const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')
    const put = vi.fn(async () => undefined)
    const bucket = { head: vi.fn(async () => null), get: vi.fn(async () => null), put }
    const waitUntil = vi.fn()
    ;(globalThis as typeof globalThis & Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_SYMBOL] = {
      env: { MAP_IMAGE_CACHE: bucket },
      ctx: { waitUntil },
    }
    try {
      const store = createMemoryExternalPlaceStore()
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/maps/api/place/textsearch/json')) {
          return {
            ok: true,
            json: async () => ({
              status: 'OK',
              results: [
                {
                  place_id: 'ChIJ_hotel',
                  name: '某酒店',
                  formatted_address: null,
                  geometry: { location: { lat: 35.01, lng: 135.76 } },
                  photos: [{ photo_reference: 'Aref_hotel_1234567890', html_attributions: [] }],
                },
              ],
            }),
          } as unknown as Response
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '3' }),
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response
      })
      const deps = buildPlanAgentServerDeps({ apiKey: 'SECRET_KEY', rateKey: 'plan-mirror', fetchImpl, placeStore: store })
      const res = await deps.places!.resolveByText('某酒店')
      expect(res).toMatchObject({ ok: true, fromCache: false })

      // 后台镜像经 waitUntil 派发；等它落地后断言
      expect(waitUntil).toHaveBeenCalled()
      await Promise.all(waitUntil.mock.calls.map(([p]) => p as Promise<unknown>))
      expect(put).toHaveBeenCalledTimes(1)
      const [, , options] = put.mock.calls[0] as unknown as [string, ArrayBuffer, { customMetadata: Record<string, string> }]
      expect(options.customMetadata.originalUrl).not.toContain('key=')
      expect(options.customMetadata.originalUrl).toContain('placeid=ChIJ_hotel')
      expect(JSON.stringify(put.mock.calls)).not.toContain('SECRET_KEY')
      // 库里已 upsert 且镜像状态落 mirrored
      expect(await store.findByPlaceId('google', 'ChIJ_hotel')).not.toBeNull()
      expect((await store.findByPlaceId('google', 'ChIJ_hotel'))?.photoMirrorStatus).toBe('mirrored')
    } finally {
      delete (globalThis as typeof globalThis & Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_SYMBOL]
    }
  })

  it('R1：runInBackground 以 ctx 为 this 调用 waitUntil（严格 this 校验下镜像照常落地）', async () => {
    const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')
    const put = vi.fn(async () => undefined)
    const bucket = { head: vi.fn(async () => null), get: vi.fn(async () => null), put }
    // 严格 ctx：waitUntil 脱离 ctx 调用（修复前的取方法引用再调用）会抛
    // Illegal invocation，镜像 promise 根本派发不出去
    const ctx = {
      received: [] as Promise<unknown>[],
      waitUntil(this: { received: Promise<unknown>[] }, promise: Promise<unknown>) {
        if (this !== ctx) throw new TypeError("Illegal invocation: function called with incorrect 'this' reference")
        this.received.push(promise)
      },
    }
    ;(globalThis as typeof globalThis & Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_SYMBOL] = {
      env: { MAP_IMAGE_CACHE: bucket },
      ctx,
    }
    try {
      const store = createMemoryExternalPlaceStore()
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/maps/api/place/textsearch/json')) {
          return {
            ok: true,
            json: async () => ({
              status: 'OK',
              results: [
                {
                  place_id: 'ChIJ_r1_strict',
                  name: '某餐厅',
                  formatted_address: null,
                  geometry: { location: { lat: 35.02, lng: 135.77 } },
                  photos: [{ photo_reference: 'Aref_r1_strict_1234567890', html_attributions: [] }],
                },
              ],
            }),
          } as unknown as Response
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '3' }),
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as unknown as Response
      })
      const deps = buildPlanAgentServerDeps({ apiKey: 'k', rateKey: 'plan-r1-strict', fetchImpl, placeStore: store })
      const res = await deps.places!.resolveByText('某餐厅')
      expect(res).toMatchObject({ ok: true, fromCache: false })
      // waitUntil 以正确 this 收到镜像 promise；等它落地
      expect(ctx.received).toHaveLength(1)
      await Promise.all(ctx.received)
      expect(put).toHaveBeenCalledTimes(1)
      expect((await store.findByPlaceId('google', 'ChIJ_r1_strict'))?.photoMirrorStatus).toBe('mirrored')
    } finally {
      delete (globalThis as typeof globalThis & Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_SYMBOL]
    }
  })
})
