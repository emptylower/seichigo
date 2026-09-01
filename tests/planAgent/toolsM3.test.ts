import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import { createPlaceResolver } from '@/lib/googlePlaces/places'
import type { TravelResult } from '@/lib/directions/googleClient'
import type { PointFinder } from '@/lib/planAgent/points'
import type { Prisma } from '@prisma/client'

const finder: PointFinder = {
  async searchBangumi() {
    return []
  },
  async countPointsByBangumi() {
    return []
  },
  async listPoints() {
    return [{ id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' }]
  },
  async getPointsByIds(ids) {
    const all = await this.listPoints(115908, 100)
    return all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))
  },
}

const mixedTravel: TravelResult = {
  ok: true,
  mode: 'transit',
  legs: [],
  durationSeconds: 2100,
  distanceMeters: 18500,
  transfers: 0,
  walkSeconds: 420,
  transitSeconds: 1680,
  polyline: [
    [34.89, 135.77],
    [34.9, 135.8],
  ],
}

type TravelInput = Parameters<NonNullable<PlanAgentToolDeps['travel']>>[0]

/** 可复用的注入 fetch 的 Google Places resolver（resolve_place 会命中它） */
function makePlaceResolver() {
  const fetchImpl = vi.fn(async () => {
    const body = {
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [
          {
            place_id: 'ChIJ_disney',
            name: '東京ディズニーランド',
            formatted_address: '千葉県浦安市舞浜 1-1',
            geometry: { location: { lat: 35.6329, lng: 139.8804 } },
            photos: [{ photo_reference: 'Aref_1234567890', html_attributions: [] }],
          },
        ],
      }),
    }
    return body as unknown as Response
  })
  return { fetchImpl, resolver: createPlaceResolver({ apiKey: 'k', rateKey: 'test-places', fetchImpl }) }
}

describe('resolve_place 工具', () => {
  async function makePlaceDeps() {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const { resolver } = makePlaceResolver()
    const deps: PlanAgentToolDeps = {
      planId: plan.id,
      repo,
      points: finder,
      places: resolver,
    }
    return { deps, repo, planId: plan.id }
  }

  it('文本解析自动选第一个结果，返回 payload-ready 的 place 与 media', async () => {
    const { deps } = await makePlaceDeps()
    const out = JSON.parse(await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' }))
    expect(out.ok).toBe(true)
    expect(out.place).toMatchObject({
      provider: 'google',
      placeId: 'ChIJ_disney',
      name: '東京ディズニーランド',
      lat: 35.6329,
      lng: 139.8804,
    })
    expect(out.media.displayUrl).toContain('/api/google/place-photo?ref=Aref_1234567890')
    expect(JSON.stringify(out)).not.toContain('key')
  })

  it('lookup(placeId) 命中已解析地点（save_plan_days 的出处验证依赖）', async () => {
    const { resolver } = makePlaceResolver()
    expect(resolver.lookup('ChIJ_disney')).toBeNull()
    await resolver.resolveByText('东京迪士尼')
    expect(resolver.lookup('ChIJ_disney')?.placeId).toBe('ChIJ_disney')
    expect(resolver.lookup('unknown')).toBeNull()
  })

  it('M3 修订：resolve_place 返回可照抄的 optionProvenance 三件套（ask 选项证据契约）', async () => {
    const { deps } = await makePlaceDeps()
    const out = JSON.parse(await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' }))
    expect(out.optionProvenance).toMatchObject({
      sourceKind: 'google_places',
      sourceUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ_disney',
    })
    expect(out.optionProvenance.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('同一 placeId 已在计划中 → alreadyInPlan 提示去重（不必重复解析）', async () => {
    const { deps } = await makePlaceDeps()
    // 先 resolve（进 resolver 缓存）再落库——出处成立
    await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' })
    const saved = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              {
                type: 'point',
                title: '東京迪士尼ランド',
                payload: {
                  place: { provider: 'google', placeId: 'ChIJ_disney', name: '東京ディズニーランド', lat: 35.6329, lng: 139.8804 },
                },
              },
            ],
          },
        ],
      }),
    )
    expect(saved.ok).toBe(true)
    const out = JSON.parse(await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' }))
    expect(out.ok).toBe(true)
    expect(out.alreadyInPlan).toBe(true)
  })

  it('未注入 places（无 key）→ 显式配置错误，引导如实告知而非编造', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const out = JSON.parse(await executePlanTool({ planId: plan.id, repo, points: finder }, 'resolve_place', { query: 'x' }))
    expect(out.error).toContain('未配置')
  })
})

describe('estimate_travel 工具', () => {
  async function makeTravelDeps() {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    return { repo, planId: plan.id }
  }

  it('工作流回归：resolve_place → estimate_travel（placeId 端点，先于任何 save）直接可用', async () => {
    const { repo, planId } = await makeTravelDeps()
    const { resolver } = makePlaceResolver()
    const travel = vi.fn(async (_input: TravelInput) => mixedTravel)
    const deps: PlanAgentToolDeps = { planId, repo, points: finder, travel, places: resolver }

    // 未知 placeId：仍显式报错（先 resolve_place）
    const unknown = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: { pointId: 'p1' },
        to: { placeId: 'ChIJ_unknown' },
        mode: 'transit',
      }),
    )
    expect(unknown.error).toContain('resolve_place')

    // 标准工作流：resolve_place 之后、save 之前，placeId 作为终点与起点都能查
    await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' })

    const toPlace = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: { pointId: 'p1' },
        to: { placeId: 'ChIJ_disney' },
        mode: 'transit',
      }),
    )
    expect(toPlace.ok).toBe(true)
    expect(travel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        origin: { lat: 34.8892, lng: 135.8075 },
        destination: { lat: 35.6329, lng: 139.8804 },
        mode: 'transit',
      }),
    )

    const fromPlace = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: { placeId: 'ChIJ_disney' },
        to: { pointId: 'p1' },
        mode: 'driving',
      }),
    )
    expect(fromPlace.ok).toBe(true)
    expect(travel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        origin: { lat: 35.6329, lng: 139.8804 },
        destination: { lat: 34.8892, lng: 135.8075 },
        mode: 'driving',
      }),
    )

    // 全程没有发生任何 save：计划仍为空，证明不需要中间落库
    expect((await repo.getPlan(planId))?.days).toHaveLength(0)
  })

  it('placeId 端点：resolver 冷缓存（如服务重启）时，计划内已持久化的 place 仍可用', async () => {
    const { repo, planId } = await makeTravelDeps()
    const { resolver } = makePlaceResolver()
    // 先解析并落库
    const seeded: PlanAgentToolDeps = { planId, repo, points: finder, places: resolver }
    await executePlanTool(seeded, 'resolve_place', { query: '东京迪士尼' })
    const resolved = JSON.parse(await executePlanTool(seeded, 'resolve_place', { query: '东京迪士尼' }))
    await executePlanTool(seeded, 'save_plan_days', {
      days: [{ dayIndex: 1, items: [{ type: 'point', title: 'D', payload: { place: resolved.place } }] }],
    })

    // 新一轮（冷 resolver、无 places）：持久化 placeId 端点照常工作
    const travel = vi.fn(async (_input: TravelInput) => mixedTravel)
    const coldDeps: PlanAgentToolDeps = { planId, repo, points: finder, travel }
    const out = JSON.parse(
      await executePlanTool(coldDeps, 'estimate_travel', {
        from: { placeId: 'ChIJ_disney' },
        to: { pointId: 'p1' },
        mode: 'transit',
      }),
    )
    expect(out.ok).toBe(true)
    expect(travel).toHaveBeenCalledWith(
      expect.objectContaining({ origin: { lat: 35.6329, lng: 139.8804 }, destination: { lat: 34.8892, lng: 135.8075 } }),
    )
  })

  it('站内点位端点解析坐标并返回 transportPayload（模型可原样落库）', async () => {
    const { repo, planId } = await makeTravelDeps()
    const travel = vi.fn(async (_input: TravelInput) => mixedTravel)
    const deps: PlanAgentToolDeps = { planId, repo, points: finder, travel }
    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: { pointId: 'p1' },
        to: { placeId: 'ChIJ_disney' },
        mode: 'transit',
      }),
    )
    // placeId 尚未解析/持久化 → 应先报错引导 resolve_place
    expect(out.error).toContain('resolve_place')

    // 直接坐标端点照常工作（行为保持不变）
    const direct = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: { pointId: 'p1' },
        to: { lat: 34.98, lng: 135.75 },
        mode: 'transit',
      }),
    )
    expect(direct.ok).toBe(true)
    expect(direct.transportPayload).toMatchObject({ mode: 'transit', durationMin: 35, distanceKm: 18.5, provider: 'google' })
    expect(travel).toHaveBeenCalledWith(expect.objectContaining({ origin: { lat: 34.8892, lng: 135.8075 }, mode: 'transit' }))
  })

  it('精确日期（startDate + dayIndex + departureTime）→ 真实 departure_time 传入查询', async () => {
    const { repo, planId } = await makeTravelDeps()
    await repo.updateMeta(planId, { startDate: new Date('2026-09-15T00:00:00Z') })
    const travel = vi.fn(async (_input: TravelInput) => mixedTravel)
    const deps: PlanAgentToolDeps = { planId, repo, points: finder, travel }

    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: { lat: 34.89, lng: 135.77 },
        to: { lat: 34.98, lng: 135.75 },
        mode: 'driving',
        dayIndex: 2,
        departureTime: '14:30',
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.dateNote).toContain('第 2 天')
    expect(out.dateNote).toContain('14:30')
    // 2026-09-16 14:30 当地（+540）= 2026-09-16T05:30:00Z
    expect(travel).toHaveBeenCalledWith(expect.objectContaining({ departureTimeSec: Date.UTC(2026, 8, 16, 5, 30) / 1000 }))
  })

  it('模糊日期：不传 departureTimeSec，dateNote 说明是估算', async () => {
    const { repo, planId } = await makeTravelDeps()
    const travel = vi.fn(async (_input: TravelInput) => mixedTravel)
    const deps: PlanAgentToolDeps = { planId, repo, points: finder, travel }
    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', {
        from: { lat: 1, lng: 2 },
        to: { lat: 3, lng: 4 },
        mode: 'walk',
      }),
    )
    expect(out.ok).toBe(true)
    expect(out.dateNote).toContain('尚未确定精确日期')
    const call = travel.mock.calls[0]![0]
    expect(call.departureTimeSec).toBeUndefined()
  })

  it('transit ZERO_RESULTS：错误带 ask_user 引导，绝不静默转步行', async () => {
    const { repo, planId } = await makeTravelDeps()
    const deps: PlanAgentToolDeps = {
      planId,
      repo,
      points: finder,
      travel: vi.fn(
        async () =>
          ({ ok: false, code: 'zero_results', message: '该路段没有查到可用的公共交通路线' }) as TravelResult,
      ),
    }
    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_travel', { from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 }, mode: 'transit' }),
    )
    expect(out.code).toBe('zero_results')
    expect(out.hint).toContain('ask_user')
    expect(out.error).toContain('公共交通')
  })

  it('未注入 travel（无 key）→ 显式配置错误并给出 estimate_transit 兜底建议', async () => {
    const { repo, planId } = await makeTravelDeps()
    const out = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'estimate_travel', {
        from: { lat: 1, lng: 2 },
        to: { lat: 3, lng: 4 },
        mode: 'transit',
      }),
    )
    expect(out.error).toContain('未配置')
  })
})

describe('save_plan_days 外部地点与归一化（M3）', () => {
  async function makeDeps() {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    return { repo, planId: plan.id }
  }

  const disneyPlace = { provider: 'google', placeId: 'ChIJ_disney', name: '東京ディズニーランド', address: '千葉県浦安市', lat: 35.6329, lng: 139.8804, mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_disney', fetchedAt: '2026-09-01T00:00:00Z' }

  /** 带 photo 的 place（resolve_place 原样返回形状），media 由调用方按需添加 */
  const disneyPlaceWithPhoto = {
    ...disneyPlace,
    photo: {
      photoReference: 'Aref_1234567890',
      displayUrl: '/api/google/place-photo?ref=Aref_1234567890&maxwidth=1600',
      attribution: 'Photo by Someone',
    },
  }

  async function makeDepsWithResolver() {
    const base = await makeDeps()
    const { resolver } = makePlaceResolver()
    const deps: PlanAgentToolDeps = { ...base, points: finder, places: resolver }
    await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' })
    return { ...base, deps }
  }

  it('外部地点条目（pointId=null + payload.place）在 resolve_place 后合法保存，参与时间轴与排序', async () => {
    const { repo, planId } = await makeDeps()
    const { resolver } = makePlaceResolver()
    const deps: PlanAgentToolDeps = { planId, repo, points: finder, places: resolver }
    // 出处前置：resolve_place 把 placeId 放进 resolver 缓存
    await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' })

    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              { type: 'transit', title: '地铁去迪士尼', payload: { transport: { mode: 'transit', durationMin: 45, distanceKm: 20 } } },
              {
                type: 'point',
                title: '東京ディズニーランド',
                timeHint: '午后',
                payload: {
                  place: disneyPlace,
                  media: { source: 'google_places', displayUrl: '/api/google/place-photo?ref=Aref_1234567890', attribution: null },
                },
              },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    const plan = await repo.getPlan(planId)
    const items = plan?.days[0].items ?? []
    expect(items.map((i) => i.title)).toEqual(['宇治桥', '地铁去迪士尼', '東京ディズニーランド'])
    const disney = items[2]
    const payload = disney?.payload as Record<string, unknown>
    expect(payload.place).toMatchObject({ placeId: 'ChIJ_disney', lat: 35.6329 })
    // "午后" → 13:00 附近的参考时刻（前序游标 10:45 未顶）
    expect(payload.schedule).toMatchObject({ confidence: 'reference' })
    expect((payload.schedule as { start?: string }).start).toMatch(/^\d{2}:\d{2}$/)
  })

  it('M3 修订：形状合法但出处不明的 place（编造）被拒绝，先要求 resolve_place', async () => {
    const { repo, planId } = await makeDeps()
    // 无 resolver 注入 + 计划内无该 placeId → 无法证明
    const out = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: '编造地点', payload: { place: disneyPlace } }] }],
      }),
    )
    expect(out.error).toContain('无法证明')
    expect((await repo.getPlan(planId))?.days).toHaveLength(0)

    // 有 resolver 但该 placeId 从未解析过（缓存未命中）同样拒绝
    const { resolver } = makePlaceResolver()
    const uncached = JSON.parse(
      await executePlanTool({ planId, repo, points: finder, places: resolver }, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: '编造地点', payload: { place: disneyPlace } }] }],
      }),
    )
    expect(uncached.error).toContain('不是本计划解析出的地点')
  })

  it('M3 修订：计划里已持久化的 place 在后续整体重存时仍可通过（read_plan → 再保存不改出处）', async () => {
    const { repo, planId } = await makeDeps()
    const { resolver } = makePlaceResolver()
    const seeded: PlanAgentToolDeps = { planId, repo, points: finder, places: resolver }
    await executePlanTool(seeded, 'resolve_place', { query: '东京迪士尼' })
    await executePlanTool(seeded, 'save_plan_days', {
      days: [{ dayIndex: 1, items: [{ type: 'point', title: 'D', payload: { place: disneyPlace } }] }],
    })

    // 新一轮保存：resolver 不可用（服务重启/无 key），但 place 已在计划里
    const resaved = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', title: 'D', payload: { place: disneyPlace } },
              { type: 'point', pointId: 'p1', title: '宇治桥' },
            ],
          },
        ],
      }),
    )
    expect(resaved.ok).toBe(true)
  })

  it('M3 修订：pointId 与 payload.place 同时出现 → 冲突拒绝', async () => {
    const { repo, planId } = await makeDeps()
    const { resolver } = makePlaceResolver()
    const deps: PlanAgentToolDeps = { planId, repo, points: finder, places: resolver }
    await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' })
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [{ type: 'point', pointId: 'p1', title: '冲突条目', payload: { place: disneyPlace } }],
          },
        ],
      }),
    )
    expect(out.error).toContain('同时带有 pointId')
    expect((await repo.getPlan(planId))?.days).toHaveLength(0)
  })

  it('M3 修订：attraction 挂带出处的合法 place 可保存；挂非法 place 显式报错（不静默丢点）', async () => {
    const { repo, planId } = await makeDeps()
    const { resolver } = makePlaceResolver()
    const deps: PlanAgentToolDeps = { planId, repo, points: finder, places: resolver }
    await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' })

    const ok = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'attraction', title: '迪士尼（非巡礼景点）', payload: { place: disneyPlace } }] }],
      }),
    )
    expect(ok.ok).toBe(true)
    const saved = await repo.getPlan(planId)
    expect(saved?.days[0].items).toHaveLength(1)

    const bad = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'attraction', title: '坏景点', payload: { place: { placeId: 'y', name: 'y', lat: 999, lng: 1 } } }] }],
      }),
    )
    expect(bad.error).toContain('payload.place 不合法')
  })

  it('M3 修订：placeId 命中但字段被篡改（lat/lng/name/provider）→ 逐一比对拒绝', async () => {
    const { repo, planId } = await makeDeps()
    const { resolver } = makePlaceResolver()
    const deps: PlanAgentToolDeps = { planId, repo, points: finder, places: resolver }
    await executePlanTool(deps, 'resolve_place', { query: '东京迪士尼' })

    const tamperedCases: Array<{ place: Record<string, unknown>; expectPhrase: string }> = [
      { place: { ...disneyPlace, lat: 35.7 }, expectPhrase: 'lat' },
      { place: { ...disneyPlace, lng: 140.0 }, expectPhrase: 'lng' },
      { place: { ...disneyPlace, name: '假冒迪士尼' }, expectPhrase: 'name' },
      { place: { ...disneyPlace, provider: 'fake' }, expectPhrase: 'provider' },
    ]
    for (const { place, expectPhrase } of tamperedCases) {
      const out = JSON.parse(
        await executePlanTool(deps, 'save_plan_days', {
          days: [{ dayIndex: 1, items: [{ type: 'point', title: '被篡改的地点', payload: { place } }] }],
        }),
      )
      expect(out.error).toContain('被改动')
      expect(out.error).toContain(expectPhrase)
    }
    expect((await repo.getPlan(planId))?.days).toHaveLength(0)

    // 原样照抄仍然通过
    const verbatim = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: 'D', payload: { place: disneyPlace } }] }],
      }),
    )
    expect(verbatim.ok).toBe(true)
  })

  it('M3 修订：计划内已持久化的 place 同样按字段比对（重存时偷换坐标被拒）', async () => {
    const { repo, planId } = await makeDeps()
    const { resolver } = makePlaceResolver()
    const seeded: PlanAgentToolDeps = { planId, repo, points: finder, places: resolver }
    await executePlanTool(seeded, 'resolve_place', { query: '东京迪士尼' })
    await executePlanTool(seeded, 'save_plan_days', {
      days: [{ dayIndex: 1, items: [{ type: 'point', title: 'D', payload: { place: disneyPlace } }] }],
    })

    // 重存时把 lat 改掉——出处（持久化数据）逐字段比对拒绝
    const tampered = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: 'D', payload: { place: { ...disneyPlace, lat: 35.9999 } } }] }],
      }),
    )
    expect(tampered.error).toContain('被改动')
    expect(tampered.error).toContain('lat')
  })

  it('M3 容错：place-only 载荷落库时派生 payload.media（站内 Google photo 代理 URL）', async () => {
    const { deps, repo, planId } = await makeDepsWithResolver()
    // 模型只照抄了 place（带 photo），漏掉了单独的 media
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: '東京迪士尼ランド', payload: { place: disneyPlaceWithPhoto } }] }],
      }),
    )
    expect(out.ok).toBe(true)

    // 实际 repo 返回值（落库后回读）里的 payload.media 存在且字段正确
    const plan = await repo.getPlan(planId)
    const item = plan?.days[0].items[0]
    const media = (item?.payload as Record<string, unknown>).media as Record<string, unknown>
    expect(media).toEqual({
      source: 'google_places',
      displayUrl: '/api/google/place-photo?ref=Aref_1234567890&maxwidth=1600',
      attribution: 'Photo by Someone',
      photoReference: 'Aref_1234567890',
    })
    // UI 主路径读取：getMedia（DayCards 用）命中派生 media
    const { getMedia } = await import('@/app/(authed)/plan/[id]/components/itemPayload')
    expect(getMedia(item!)).toEqual({
      source: 'google_places',
      displayUrl: '/api/google/place-photo?ref=Aref_1234567890&maxwidth=1600',
      attribution: 'Photo by Someone',
    })
  })

  it('M3 容错：模型已提供合法 media 时不被派生覆盖（保持其值与优先级）', async () => {
    const { deps, repo, planId } = await makeDepsWithResolver()
    const explicitMedia = { source: 'google_places', displayUrl: '/api/google/place-photo?ref=Otherref_987654321&maxwidth=800' }
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [{ type: 'point', title: 'D', payload: { place: disneyPlaceWithPhoto, media: explicitMedia } }],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    const plan = await repo.getPlan(planId)
    const media = (plan?.days[0].items[0]?.payload as Record<string, unknown>).media as Record<string, unknown>
    expect(media).toEqual(explicitMedia)
  })

  it('M3 容错：media.displayUrl 无效时被安全 URL 替换；place.photo 的 URL 不安全绝不注入', async () => {
    const { deps, repo, planId } = await makeDepsWithResolver()

    // media.displayUrl 无效（外部带密钥 URL）+ place.photo 安全 → 派生替换
    const replaced = await executePlanTool(deps, 'save_plan_days', {
      days: [
        {
          dayIndex: 1,
          items: [
            {
              type: 'point',
              title: 'D',
              payload: {
                place: disneyPlaceWithPhoto,
                media: { source: 'google_places', displayUrl: 'https://maps.googleapis.com/photo?photoreference=R&key=SECRET' },
              },
            },
          ],
        },
      ],
    })
    expect(JSON.parse(replaced).ok).toBe(true)
    const planAfterReplace = await repo.getPlan(planId)
    const replacedMedia = (planAfterReplace?.days[0].items[0]?.payload as Record<string, unknown>).media as Record<string, unknown>
    expect(replacedMedia.displayUrl).toBe('/api/google/place-photo?ref=Aref_1234567890&maxwidth=1600')

    // place.photo.displayUrl 是任意外部 URL（未经验证）→ 不注入 media，保持无图降级
    const unsafePlace = { ...disneyPlaceWithPhoto, photo: { photoReference: 'Aref_1234567890', displayUrl: 'https://evil.com/steal.jpg', attribution: null } }
    const unsafe = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: 'D2', payload: { place: unsafePlace } }] }],
      }),
    )
    expect(unsafe.ok).toBe(true)
    const planUnsafe = await repo.getPlan(planId)
    const unsafeItem = planUnsafe?.days[0].items[0]
    expect((unsafeItem?.payload as Record<string, unknown>).media).toBeUndefined()

    // 带密钥的绝对代理 URL 同样不注入（密钥绝不进落库载荷）
    const keyedPlace = { ...disneyPlaceWithPhoto, photo: { photoReference: 'Aref_1234567890', displayUrl: '/api/google/place-photo?ref=Aref_1234567890&key=SECRET', attribution: null } }
    const keyed = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: 'D3', payload: { place: keyedPlace } }] }],
      }),
    )
    expect(keyed.ok).toBe(true)
    const planKeyed = await repo.getPlan(planId)
    expect((planKeyed?.days[0].items[0]?.payload as Record<string, unknown>).media).toBeUndefined()
  })

  it('point 条目既无 pointId 也无合法 payload.place → 显式错误', async () => {
    const { repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: '无名地点' }] }],
      }),
    )
    expect(out.error).toContain('payload.place')
    expect((await repo.getPlan(planId))?.days).toHaveLength(0)
  })

  it('payload.place 坐标非法 → 显式错误', async () => {
    const { repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [{ type: 'point', title: '坏坐标', payload: { place: { placeId: 'x', name: 'x', lat: 999, lng: 1 } } }],
          },
        ],
      }),
    )
    expect(out.error).toContain('范围')
  })

  it('pointId 在点位库中不存在（无坐标）→ 显式 missing 错误', async () => {
    const { repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', pointId: 'ghost-id', title: '幽灵点位' }] }],
      }),
    )
    expect(out.error).toContain('未找到')
    expect(out.missing).toEqual(['ghost-id'])
  })

  it('时间冲突 → 归一化错误透出（含天序号与冲突明细），计划不被写入', async () => {
    const { repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'free', title: 'A', timeHint: '10:00-12:00' },
              { type: 'free', title: 'B', timeHint: '11:00-12:00' },
            ],
          },
        ],
      }),
    )
    expect(out.error).toContain('归一化失败')
    expect(out.errors.join('')).toContain('重叠')
    expect((await repo.getPlan(planId))?.days).toHaveLength(0)
  })

  it('transport payload 超限时先裁 polyline/legs，仍可保存', async () => {
    const { repo, planId } = await makeDeps()
    const hugePolyline = Array.from({ length: 5000 }, (_, i) => [i / 1000, i / 1000] as [number, number])
    const out = JSON.parse(
      await executePlanTool({ planId, repo, points: finder }, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            items: [
              { type: 'point', pointId: 'p1', title: '宇治桥' },
              {
                type: 'transit',
                title: '超长交通段',
                payload: { transport: { mode: 'driving', durationMin: 60, distanceKm: 50, polyline: hugePolyline } },
              },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    const plan = await repo.getPlan(planId)
    const transit = plan?.days[0].items.find((i) => i.type === 'transit')
    const transport = (transit?.payload as Record<string, unknown>).transport as Record<string, unknown> | undefined
    expect(transport).toBeDefined()
    expect(JSON.stringify(transit?.payload).length).toBeLessThan(25_000)
  })
})

describe('estimate_transit 兼容标记', () => {
  it('旧启发式估算返回 estimated: true（模型可向用户注明估算值）', async () => {
    const repo = new MemoryTripPlanRepo()
    const plan = await repo.createPlan({ userId: 'u1', title: 't' })
    const out = JSON.parse(
      await executePlanTool({ planId: plan.id, repo, points: finder }, 'estimate_transit', {
        fromPointId: 'p1',
        toPointId: 'p1',
      }),
    )
    expect(out.estimated).toBe(true)
  })
})
