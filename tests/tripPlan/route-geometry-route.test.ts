import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryTripPlanRepo } from '@/lib/tripPlan/repoMemory'
import { GET } from '@/app/api/me/plans/[id]/route-geometry/route'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  geometryGet: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/routeBook/handlers/routeGeometry', () => ({
  createRouteGeometryHandler: () => ({ GET: mocks.geometryGet }),
}))

let deps: { repo: MemoryTripPlanRepo; getSession: () => Promise<unknown> }

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: () => deps,
}))

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/me/plans/[id]/route-geometry', () => {
  beforeEach(() => {
    mocks.getSession.mockReset()
    mocks.geometryGet.mockReset()
    mocks.getSession.mockResolvedValue({ user: { id: 'u1' } })
    deps = { repo: new MemoryTripPlanRepo(), getSession: mocks.getSession }
  })

  it('rejects unauthenticated requests without touching the geometry handler', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/me/plans/p1/route-geometry'), makeCtx('p1'))
    expect(res.status).toBe(401)
    expect(mocks.geometryGet).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing plan', async () => {
    const res = await GET(new Request('http://localhost/api/me/plans/nope/route-geometry'), makeCtx('nope'))
    expect(res.status).toBe(404)
    expect(mocks.geometryGet).not.toHaveBeenCalled()
  })

  it('returns 403 for a plan owned by another user', async () => {
    const other = await deps.repo.createPlan({ userId: 'u2', title: 'not mine' })
    const res = await GET(new Request(`http://localhost/api/me/plans/${other.id}/route-geometry`), makeCtx(other.id))
    expect(res.status).toBe(403)
    expect(mocks.geometryGet).not.toHaveBeenCalled()
  })

  it('forwards an authorized request to the geometry handler with the session user id', async () => {
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 'mine' })
    const forwarded = new Response(JSON.stringify({ ok: true, geometry: null }), { status: 200 })
    mocks.geometryGet.mockResolvedValue(forwarded)

    const req = new Request(`http://localhost/api/me/plans/${plan.id}/route-geometry?points=139.7,35.6|135.5,34.7&mode=walking`)
    const res = await GET(req, makeCtx(plan.id))

    expect(res).toBe(forwarded)
    expect(mocks.geometryGet).toHaveBeenCalledTimes(1)
    expect(mocks.geometryGet).toHaveBeenCalledWith(req, 'u1')
  })

  it('relays the geometry handler error response untouched', async () => {
    const plan = await deps.repo.createPlan({ userId: 'u1', title: 'mine' })
    const forwarded = new Response(JSON.stringify({ ok: false, error: '缺少 points 参数' }), { status: 400 })
    mocks.geometryGet.mockResolvedValue(forwarded)

    const res = await GET(new Request(`http://localhost/api/me/plans/${plan.id}/route-geometry`), makeCtx(plan.id))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error: '缺少 points 参数' })
  })
})
