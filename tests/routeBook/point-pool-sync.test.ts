import { describe, expect, it } from 'vitest'
import type { Session } from 'next-auth'
import { createHandlers } from '@/lib/routeBook/handlers/routebookPoints'
import { InMemoryRouteBookRepo } from '@/lib/routeBook/repoMemory'
import { InMemoryPointPoolRepo } from '@/lib/pointPool/repoMemory'

describe('routebook points + point pool sync', () => {
  it('removes point from point pool when adding to routebook, and puts it back when removed from all routebooks', async () => {
    const repo = new InMemoryRouteBookRepo()
    const pointPoolRepo = new InMemoryPointPoolRepo()

    const userId = 'u1'
    const routeBook = await repo.create(userId, '计划A', 'draft')
    await pointPoolRepo.upsert(userId, 'p100')

    const handlers = createHandlers({
      repo,
      pointPoolRepo,
      getSession: async () => ({ user: { id: userId } } as Session),
      now: () => new Date('2026-02-19T10:00:00.000Z'),
    })

    const addReq = new Request('http://localhost/api/me/routebooks/1/points', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pointId: 'p100', zone: 'unsorted' }),
    })

    const addRes = await handlers.POST(addReq, { params: Promise.resolve({ id: routeBook.id }) })
    expect(addRes.status).toBe(200)
    expect(await pointPoolRepo.has(userId, 'p100')).toBe(false)

    const delReq = new Request('http://localhost/api/me/routebooks/1/points', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pointId: 'p100' }),
    })

    const delRes = await handlers.DELETE(delReq, { params: Promise.resolve({ id: routeBook.id }) })
    expect(delRes.status).toBe(200)
    expect(await pointPoolRepo.has(userId, 'p100')).toBe(true)
  })
})
