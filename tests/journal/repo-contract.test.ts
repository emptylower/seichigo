import { describe, expect, it } from 'vitest'
import { InMemoryJournalReadRepo, type SeedData } from '@/lib/journal/repoMemory'

const baseSeed: SeedData = {
  users: [
    { id: 'u1', name: 'Lily', image: null, bio: null, createdAt: new Date('2024-10-04') },
  ],
  checkins: [],
  routeBooks: [],
  worksVisited: 0,
  pointsVisited: 0,
  notesPublished: 0,
}

describe('InMemoryJournalReadRepo', () => {
  it('returns null for unknown user', async () => {
    const repo = new InMemoryJournalReadRepo(baseSeed)
    expect(await repo.getUser('nope')).toBeNull()
  })

  it('returns the user row when present', async () => {
    const repo = new InMemoryJournalReadRepo(baseSeed)
    const user = await repo.getUser('u1')
    expect(user?.name).toBe('Lily')
  })

  it('returns empty arrays and zero counts for a user with no activity', async () => {
    const repo = new InMemoryJournalReadRepo(baseSeed)
    expect(await repo.listCheckins('u1')).toEqual([])
    expect(await repo.listRouteBooks('u1')).toEqual([])
    expect(await repo.countDistinctWorksVisited('u1')).toBe(0)
    expect(await repo.countDistinctPointsVisited('u1')).toBe(0)
    expect(await repo.countNotesPublished('u1')).toBe(0)
  })

  it('scopes checkins and routebooks by userId', async () => {
    const repo = new InMemoryJournalReadRepo({
      ...baseSeed,
      checkins: [
        {
          userId: 'u1',
          pointId: 'p1',
          geoLat: 35.3,
          geoLng: 139.5,
          prefectureZh: '神奈川',
          workTitle: '灌篮高手',
          workId: 'slamdunk',
          totalPointsForWork: 12,
          photoUrl: null,
          placeName: '镰仓高校前',
          checkedInAt: new Date('2025-03-20'),
          isMostRecent: true,
        },
        {
          userId: 'u2',
          pointId: 'p2',
          geoLat: 0,
          geoLng: 0,
          prefectureZh: null,
          workTitle: null,
          workId: null,
          totalPointsForWork: null,
          photoUrl: null,
          placeName: 'other-user-point',
          checkedInAt: new Date('2025-03-20'),
          isMostRecent: true,
        },
      ],
    })
    const checkins = await repo.listCheckins('u1')
    expect(checkins).toHaveLength(1)
    expect(checkins[0].placeName).toBe('镰仓高校前')
  })
})
