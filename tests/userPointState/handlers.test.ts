import { describe, expect, it } from 'vitest'
import type { Session } from 'next-auth'
import { createHandlers } from '@/lib/userPointState/handlers/pointStates'
import { InMemoryUserPointStateRepo } from '@/lib/userPointState/repoMemory'
import { InMemoryPointPoolRepo } from '@/lib/pointPool/repoMemory'
import { InMemoryRouteBookRepo } from '@/lib/routeBook/repoMemory'

describe('user point state handlers', () => {
  it('rejects non checked-in state writes', async () => {
    const pointBangumiMap = new Map<string, number>([['p1', 1]])
    const handlers = createHandlers({
      repo: new InMemoryUserPointStateRepo({ pointBangumiMap }),
      pointPoolRepo: new InMemoryPointPoolRepo({ pointBangumiMap }),
      routeBookRepo: new InMemoryRouteBookRepo({ pointBangumiMap }),
      getSession: async () => ({ user: { id: 'u1' } } as Session),
      now: () => new Date('2026-02-19T10:00:00.000Z'),
    })

    const req = new Request('http://localhost/api/me/point-states', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pointId: 'p1', state: 'planned' }),
    })

    const res = await handlers.PUT(req)
    expect(res.status).toBe(400)
  })
})
