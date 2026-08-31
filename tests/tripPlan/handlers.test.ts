import { describe, it, expect, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { createPlansHandlers, DAILY_PLAN_CREATE_LIMIT } from '@/lib/tripPlan/handlers/plans'
import { createPlanByIdHandlers } from '@/lib/tripPlan/handlers/planById'
import type { TripPlanHandlerDeps } from '@/lib/tripPlan/handlers/plans'

function makeDeps(overrides?: Partial<TripPlanHandlerDeps>): TripPlanHandlerDeps {
  return {
    repo: new MemoryTripPlanRepo(),
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    ...overrides,
  }
}

describe('plans handlers', () => {
  it('rejects unauthenticated requests', async () => {
    const deps = makeDeps({ getSession: vi.fn().mockResolvedValue(null) })
    const res = await createPlansHandlers(deps).GET()
    expect(res.status).toBe(401)
  })

  it('creates a plan and lists it', async () => {
    const deps = makeDeps()
    const post = await createPlansHandlers(deps).POST(
      new Request('http://localhost/api/me/plans', {
        method: 'POST',
        body: JSON.stringify({ title: '京都京吹巡礼' }),
      }),
    )
    expect(post.status).toBe(201)
    const created = await post.json()
    expect(created.plan.title).toBe('京都京吹巡礼')

    const list = await createPlansHandlers(deps).GET()
    const body = await list.json()
    expect(body.plans).toHaveLength(1)
  })

  it('enforces the daily creation quota', async () => {
    const deps = makeDeps()
    for (let i = 0; i < DAILY_PLAN_CREATE_LIMIT; i++) {
      const res = await createPlansHandlers(deps).POST(
        new Request('http://localhost/api/me/plans', { method: 'POST', body: JSON.stringify({ title: `p${i}` }) }),
      )
      expect(res.status).toBe(201)
    }
    const blocked = await createPlansHandlers(deps).POST(
      new Request('http://localhost/api/me/plans', { method: 'POST', body: JSON.stringify({ title: 'over' }) }),
    )
    expect(blocked.status).toBe(429)
  })
})

describe('planById handlers', () => {
  it('returns 404 for missing plan and 403 for others plans', async () => {
    const deps = makeDeps()
    const handlers = createPlanByIdHandlers(deps)
    expect((await handlers.GET('nope')).status).toBe(404)

    const other = await deps.repo.createPlan({ userId: 'u2', title: 'not mine' })
    expect((await handlers.GET(other.id)).status).toBe(403)
  })

  it('returns the plan view with days and patches meta', async () => {
    const deps = makeDeps()
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 't' })
    await deps.repo.replaceDays(plan.id, [
      { dayIndex: 1, summary: '宇治日', items: [{ type: 'point', pointId: 'p1', title: '宇治桥' }] },
    ])
    const handlers = createPlanByIdHandlers(deps)

    const got = await handlers.GET(plan.id)
    expect(got.status).toBe(200)
    const body = await got.json()
    expect(body.plan.days).toHaveLength(1)
    expect(typeof body.plan.updatedAt).toBe('string')
    expect(body.chat).toEqual([])

    const patched = await handlers.PATCH(
      plan.id,
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ title: '新', status: 'upcoming' }) }),
    )
    expect(patched.status).toBe(200)

    const bad = await handlers.PATCH(
      plan.id,
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ status: 'bogus' }) }),
    )
    expect(bad.status).toBe(400)
  })
})
