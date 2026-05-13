import { describe, expect, it } from 'vitest'
import { getJournalSnapshot } from '@/lib/journal/handlers/getJournalSnapshot'
import { InMemoryJournalReadRepo } from '@/lib/journal/repoMemory'

const NOW = new Date('2025-03-20T08:00:00Z')

function makeRepo(overrides: Partial<ConstructorParameters<typeof InMemoryJournalReadRepo>[0]> = {}) {
  return new InMemoryJournalReadRepo({
    users: [
      { id: 'u1', name: 'Lily', image: null, bio: null, createdAt: new Date('2024-10-04') },
    ],
    checkins: [],
    routeBooks: [],
    worksVisited: 0,
    pointsVisited: 0,
    notesPublished: 0,
    ...overrides,
  })
}

describe('getJournalSnapshot', () => {
  it('returns null when user does not exist', async () => {
    const repo = makeRepo()
    const result = await getJournalSnapshot({ userId: 'nope', repo, now: () => NOW })
    expect(result).toBeNull()
  })

  it('returns user with derived journalNumber and daysSinceJoined', async () => {
    const repo = makeRepo()
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.user.name).toBe('Lily')
    expect(snap?.user.daysSinceJoined).toBe(167)
    expect(snap?.user.journalNumber).toMatch(/^#\d{4}$/)
  })

  it('returns zeroed stats for inactive user', async () => {
    const repo = makeRepo()
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.stats).toEqual({
      worksVisited: 0,
      pointsVisited: 0,
      totalCheckins: 0,
      totalKilometers: 0,
      totalTrips: 0,
    })
  })

  it('aggregates stats and timeline from checkins and routebooks', async () => {
    const repo = makeRepo({
      worksVisited: 5,
      pointsVisited: 47,
      checkins: Array.from({ length: 156 }, (_, i) => ({
        userId: 'u1',
        pointId: `p${i}`,
        geoLat: 35 + (i % 5) * 0.1,
        geoLng: 139 + (i % 7) * 0.1,
        prefectureZh: ['神奈川', '京都', '山梨'][i % 3],
        workTitle: '灌篮高手',
        workId: 'slamdunk',
        totalPointsForWork: 12,
        photoUrl: i % 20 === 0 ? `https://example.com/p${i}.jpg` : null,
        placeName: `point-${i}`,
        checkedInAt: new Date(`2025-0${(i % 9) + 1}-15`),
        isMostRecent: i === 155,
      })),
      routeBooks: [
        {
          userId: 'u1',
          id: 'rb1',
          title: '镰仓·灌篮高手回忆',
          status: 'in_progress',
          metadata: { departureDate: '2025-03-15' },
          pointCount: 8,
          createdAt: new Date('2025-03-01'),
          updatedAt: new Date('2025-03-19'),
          workTitle: '灌篮高手',
          locationZh: '神奈川',
        },
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.stats.totalCheckins).toBe(156)
    expect(snap?.stats.worksVisited).toBe(5)
    expect(snap?.stats.pointsVisited).toBe(47)
    expect(snap?.stats.totalTrips).toBe(1)
    expect(snap?.tripsForTimeline).toHaveLength(1)
    expect(snap?.tripsForTimeline[0].title).toBe('镰仓·灌篮高手回忆')
    expect(snap?.tripsForTimeline[0].status).toBe('in_progress')
  })

  it('picks the in_progress routebook as currentTrip, else the latest draft', async () => {
    const repo = makeRepo({
      routeBooks: [
        {
          userId: 'u1', id: 'rb1', title: '旧草稿', status: 'draft',
          metadata: null, pointCount: 3,
          createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'),
          workTitle: null, locationZh: null,
        },
        {
          userId: 'u1', id: 'rb2', title: '京都·CLANNAD 之旅', status: 'in_progress',
          metadata: { departureDate: '2025-04-12' }, pointCount: 12,
          createdAt: new Date('2025-03-01'), updatedAt: new Date('2025-03-15'),
          workTitle: 'CLANNAD', locationZh: '京都',
        },
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.currentTrip?.id).toBe('rb2')
    expect(snap?.currentTrip?.title).toBe('京都·CLANNAD 之旅')
    expect(snap?.currentTrip?.status).toBe('in_progress')
    expect(snap?.currentTrip?.pointCount).toBe(12)
  })

  it('returns prefectures sorted by descending pointCount', async () => {
    const repo = makeRepo({
      checkins: [
        { userId: 'u1', pointId: 'a', geoLat: 35, geoLng: 139, prefectureZh: '京都', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'a', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        { userId: 'u1', pointId: 'b', geoLat: 35, geoLng: 139, prefectureZh: '京都', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'b', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        { userId: 'u1', pointId: 'c', geoLat: 35, geoLng: 139, prefectureZh: '神奈川', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'c', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        { userId: 'u1', pointId: 'd', geoLat: 35, geoLng: 139, prefectureZh: '神奈川', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'd', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        { userId: 'u1', pointId: 'e', geoLat: 35, geoLng: 139, prefectureZh: '神奈川', workTitle: null, workId: null, totalPointsForWork: null, photoUrl: null, placeName: 'e', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.prefectures.map((p) => p.nameZh)).toEqual(['神奈川', '京都'])
    expect(snap?.prefectures[0].pointCount).toBe(3)
    expect(snap?.prefectures[1].pointCount).toBe(2)
  })

  it('returns travelModeBreakdown summing to 100 (W1 stub values)', async () => {
    const repo = makeRepo()
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    const sum = snap!.travelModeBreakdown.reduce((acc, m) => acc + m.percent, 0)
    expect(sum).toBe(100)
    expect(snap?.travelModeBreakdown.map((m) => m.mode).sort()).toEqual(['bus', 'car', 'train', 'walk'])
  })

  it('returns recentNotes empty array in W1', async () => {
    const repo = makeRepo({ notesPublished: 42 })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.recentNotes).toEqual([])
  })

  it('returns up to 4 most-recent photos, newest first', async () => {
    const repo = makeRepo({
      checkins: [
        { userId: 'u1', pointId: 'p1', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'A', workId: 'a', totalPointsForWork: null, photoUrl: 'https://x/1.jpg', placeName: 'A站', checkedInAt: new Date('2025-03-20'), isMostRecent: true },
        { userId: 'u1', pointId: 'p2', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'B', workId: 'b', totalPointsForWork: null, photoUrl: 'https://x/2.jpg', placeName: 'B站', checkedInAt: new Date('2025-03-19'), isMostRecent: false },
        { userId: 'u1', pointId: 'p3', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'C', workId: 'c', totalPointsForWork: null, photoUrl: null, placeName: 'C站', checkedInAt: new Date('2025-03-18'), isMostRecent: false },
        { userId: 'u1', pointId: 'p4', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'D', workId: 'd', totalPointsForWork: null, photoUrl: 'https://x/4.jpg', placeName: 'D站', checkedInAt: new Date('2025-03-17'), isMostRecent: false },
        { userId: 'u1', pointId: 'p5', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'E', workId: 'e', totalPointsForWork: null, photoUrl: 'https://x/5.jpg', placeName: 'E站', checkedInAt: new Date('2025-03-16'), isMostRecent: false },
        { userId: 'u1', pointId: 'p6', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: 'F', workId: 'f', totalPointsForWork: null, photoUrl: 'https://x/6.jpg', placeName: 'F站', checkedInAt: new Date('2025-03-15'), isMostRecent: false },
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.recentPhotos).toHaveLength(4)
    expect(snap?.recentPhotos[0].photoUrl).toBe('https://x/1.jpg')
    expect(snap?.recentPhotos.map((p) => p.placeName)).toEqual(['A站', 'B站', 'D站', 'E站'])
  })

  it('builds workProgress for each work seen, sorted by percent desc', async () => {
    const repo = makeRepo({
      checkins: [
        { userId: 'u1', pointId: 'a1', geoLat: 0, geoLng: 0, prefectureZh: null, workTitle: '你的名字。', workId: 'kimi', totalPointsForWork: 14, photoUrl: null, placeName: 'a1', checkedInAt: new Date('2025-01-01'), isMostRecent: false },
        ...Array.from({ length: 13 }, (_, i) => ({
          userId: 'u1', pointId: `kimi-${i}`, geoLat: 0, geoLng: 0, prefectureZh: null,
          workTitle: '你的名字。', workId: 'kimi', totalPointsForWork: 14, photoUrl: null,
          placeName: `kimi-${i}`, checkedInAt: new Date('2025-01-01'), isMostRecent: false,
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          userId: 'u1', pointId: `sd-${i}`, geoLat: 0, geoLng: 0, prefectureZh: null,
          workTitle: '灌篮高手', workId: 'slamdunk', totalPointsForWork: 12, photoUrl: null,
          placeName: `sd-${i}`, checkedInAt: new Date('2025-02-01'), isMostRecent: false,
        })),
      ],
    })
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.workProgress.map((w) => w.workTitle)).toEqual(['你的名字。', '灌篮高手'])
    expect(snap?.workProgress[0].percent).toBe(100)
    expect(snap?.workProgress[1].percent).toBe(67)
  })

  it('exposes 8 achievements in fixed order from achievements module', async () => {
    const repo = makeRepo()
    const snap = await getJournalSnapshot({ userId: 'u1', repo, now: () => NOW })
    expect(snap?.achievements).toHaveLength(8)
    expect(snap?.achievements[0].id).toBe('first-checkin')
  })
})
