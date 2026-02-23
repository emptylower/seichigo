import { describe, expect, it } from 'vitest'
import { InMemoryUserPointStateRepo } from '@/lib/userPointState/repoMemory'
import { InMemoryPointPoolRepo } from '@/lib/pointPool/repoMemory'
import { InMemoryRouteBookRepo } from '@/lib/routeBook/repoMemory'
import { resolveUserPointStates } from '@/lib/userPointState/stateResolver'

describe('resolveUserPointStates', () => {
  it('resolves state priority as checked_in > planned > want_to_go', async () => {
    const pointBangumiMap = new Map<string, number>([
      ['p1', 1],
      ['p2', 1],
      ['p3', 2],
    ])

    const pointStateRepo = new InMemoryUserPointStateRepo({ pointBangumiMap })
    const pointPoolRepo = new InMemoryPointPoolRepo({ pointBangumiMap })
    const routeBookRepo = new InMemoryRouteBookRepo({ pointBangumiMap })
    const userId = 'u1'

    const routeBook = await routeBookRepo.create(userId, '我的路书', 'draft')
    await routeBookRepo.addPoint(routeBook.id, userId, 'p1', 'sorted')
    await routeBookRepo.addPoint(routeBook.id, userId, 'p2', 'unsorted')

    await pointPoolRepo.upsert(userId, 'p1')
    await pointPoolRepo.upsert(userId, 'p3')

    await pointStateRepo.upsert(userId, 'p1', 'checked_in', {
      checkedInAt: new Date('2026-02-19T10:00:00.000Z'),
      gpsVerified: true,
    })

    const resolved = await resolveUserPointStates(
      {
        pointStateRepo,
        pointPoolRepo,
        routeBookRepo,
      },
      userId
    )

    expect(resolved.find((row) => row.pointId === 'p1')?.state).toBe('checked_in')
    expect(resolved.find((row) => row.pointId === 'p2')?.state).toBe('planned')
    expect(resolved.find((row) => row.pointId === 'p3')?.state).toBe('want_to_go')

    const plannedOnly = await resolveUserPointStates(
      {
        pointStateRepo,
        pointPoolRepo,
        routeBookRepo,
      },
      userId,
      { state: 'planned' }
    )
    expect(plannedOnly).toHaveLength(1)
    expect(plannedOnly[0]?.pointId).toBe('p2')

    const bangumiOne = await resolveUserPointStates(
      {
        pointStateRepo,
        pointPoolRepo,
        routeBookRepo,
      },
      userId,
      { bangumiId: 1 }
    )
    expect(bangumiOne.map((row) => row.pointId).sort()).toEqual(['p1', 'p2'])
  })
})
