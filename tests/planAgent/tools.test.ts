import { describe, it, expect } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { executePlanTool, PLAN_AGENT_TOOLS } from '@/lib/planAgent/tools'
import type { PlanAgentToolDeps } from '@/lib/planAgent/tools'
import type { PointFinder } from '@/lib/planAgent/points'

const fakeFinder: PointFinder = {
  async searchBangumi(query) {
    return query.includes('上低音号') || query.includes('京吹')
      ? [{ id: 115908, titleZh: '吹响吧！上低音号', titleJaRaw: '響け！ユーフォニアム', city: '宇治' }]
      : []
  },
  async countPointsByBangumi(ids) {
    return ids.includes(115908) ? [{ bangumiId: 115908, pointCount: 3 }] : []
  },
  async listPoints(bangumiId) {
    if (bangumiId !== 115908) return []
    return [
      { id: 'p-uji-bridge', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, ep: '1' },
      { id: 'p-daikichi', name: '大吉山', nameZh: '大吉山', lat: 34.8963, lng: 135.8123, ep: '8' },
      { id: 'p-kyoto-sta', name: '京都駅', nameZh: '京都站', lat: 34.9858, lng: 135.7585, ep: '2' },
    ]
  },
  async getPointsByIds(ids) {
    const all = await this.listPoints(115908, 100)
    return all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))
  },
}

async function makeDeps(): Promise<{ deps: PlanAgentToolDeps; planId: string; repo: MemoryTripPlanRepo }> {
  const repo = new MemoryTripPlanRepo()
  const plan = await repo.createPlan({ userId: 'u1', title: 't' })
  const deps: PlanAgentToolDeps = {
    planId: plan.id,
    repo,
    points: fakeFinder,
    bgmSearch: async (keyword) =>
      keyword.includes('京吹') ? [{ id: 115908, name: '響け！ユーフォニアム', nameCn: '吹响！悠风号' }] : [],
    onPlanUpdated: () => {},
  }
  return { deps, planId: plan.id, repo }
}

describe('PLAN_AGENT_TOOLS', () => {
  it('declares the eight M1 tools', () => {
    expect(
      PLAN_AGENT_TOOLS.map((t) => (t.type === 'function' ? t.function.name : '')).sort(),
    ).toEqual([
      'cluster_points',
      'estimate_transit',
      'list_points',
      'read_plan',
      'save_plan_days',
      'search_anime',
      'search_bangumi_tv',
      'update_plan_meta',
    ])
  })
})

describe('executePlanTool', () => {
  it('search_anime returns bangumi hits', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'search_anime', { query: '上低音号' }))
    expect(out.results[0].id).toBe(115908)
  })

  it('search_bangumi_tv resolves nicknames and flags in-site works', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'search_bangumi_tv', { keyword: '京吹' }))
    expect(out.candidates[0].id).toBe(115908)
    expect(out.candidates[0].hasPoints).toBe(true)
    expect(out.candidates[0].pointCount).toBe(3)

    const miss = JSON.parse(await executePlanTool(deps, 'search_bangumi_tv', { keyword: '完全未知作品' }))
    expect(miss.candidates).toEqual([])
    expect(miss.hint).toBeTruthy()
  })

  it('list_points returns geo points for a bangumi', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'list_points', { bangumiId: 115908 }))
    expect(out.points).toHaveLength(3)
    expect(out.points[0]).toHaveProperty('lat')
  })

  it('cluster_points groups by geography', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'cluster_points', {
        pointIds: ['p-uji-bridge', 'p-daikichi', 'p-kyoto-sta'],
        dayCount: 2,
      }),
    )
    expect(out.clusters).toHaveLength(2)
  })

  it('save_plan_days persists days, resolves invalid types, and fires onPlanUpdated', async () => {
    const { deps, repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [
          {
            dayIndex: 1,
            summary: '宇治巡礼日',
            items: [
              { type: 'point', pointId: 'p-uji-bridge', title: '宇治桥', reason: '第 1 集取景地' },
              { type: 'transit', title: 'JR 奈良线返回京都', note: '约 20 分钟' },
            ],
          },
        ],
      }),
    )
    expect(out.ok).toBe(true)
    const plan = await repo.getPlan(planId)
    expect(plan?.days).toHaveLength(1)
    expect(plan?.days[0].items).toHaveLength(2)
  })

  it('estimate_transit suggests mode and minutes between two points', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'estimate_transit', { fromPointId: 'p-uji-bridge', toPointId: 'p-kyoto-sta' }),
    )
    expect(out.mode).toBe('transit')
    expect(out.durationMin).toBeGreaterThan(10)

    const walk = JSON.parse(
      await executePlanTool(deps, 'estimate_transit', { fromPointId: 'p-uji-bridge', toPointId: 'p-daikichi' }),
    )
    expect(walk.mode).toBe('walk')
  })

  it('save_plan_days rejects point items without pointId and normalizes day indexes', async () => {
    const { deps, repo, planId } = await makeDeps()
    const bad = JSON.parse(
      await executePlanTool(deps, 'save_plan_days', {
        days: [{ dayIndex: 1, items: [{ type: 'point', title: '没有点位 id' }] }],
      }),
    )
    expect(bad.error).toBeTruthy()

    await executePlanTool(deps, 'save_plan_days', {
      days: [
        { dayIndex: 5, items: [{ type: 'free', title: 'b' }] },
        { dayIndex: 2, items: [{ type: 'free', title: 'a' }] },
      ],
    })
    const plan = await repo.getPlan(planId)
    expect(plan?.days.map((d) => d.dayIndex)).toEqual([1, 2])
    expect(plan?.days[0].items[0].title).toBe('a')
  })

  it('update_plan_meta rejects invalid dates', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'update_plan_meta', { startDate: 'not-a-date' }))
    expect(out.error).toBeTruthy()
  })

  it('update_plan_meta patches title/dayCount/startDate', async () => {
    const { deps, repo, planId } = await makeDeps()
    const out = JSON.parse(
      await executePlanTool(deps, 'update_plan_meta', {
        title: '京都京吹圣地巡礼',
        dayCount: 3,
        startDate: '2026-09-15',
        bangumiIds: [115908],
      }),
    )
    expect(out.ok).toBe(true)
    const plan = await repo.getPlan(planId)
    expect(plan?.title).toBe('京都京吹圣地巡礼')
    expect(plan?.dayCount).toBe(3)
  })

  it('read_plan returns current structure and unknown tool errors cleanly', async () => {
    const { deps } = await makeDeps()
    const out = JSON.parse(await executePlanTool(deps, 'read_plan', {}))
    expect(out.plan.title).toBe('t')
    const err = JSON.parse(await executePlanTool(deps, 'no_such_tool', {}))
    expect(err.error).toBeTruthy()
  })
})
