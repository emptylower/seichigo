import { evaluateAchievements, pickNextAchievement } from '@/lib/journal/achievements'
import type {
  JournalCheckinRow,
  JournalReadRepo,
  JournalRouteBookRow,
} from '@/lib/journal/repo'
import type { JournalSnapshot } from '@/lib/journal/types'

const DEFAULT_TRAVEL_MODES: JournalSnapshot['travelModeBreakdown'] = [
  { mode: 'train', percent: 58 },
  { mode: 'bus', percent: 20 },
  { mode: 'car', percent: 15 },
  { mode: 'walk', percent: 7 },
]

export type GetJournalSnapshotInput = {
  userId: string
  repo: JournalReadRepo
  now: () => Date
}

export async function getJournalSnapshot(
  input: GetJournalSnapshotInput,
): Promise<JournalSnapshot | null> {
  const { userId, repo, now: nowFn } = input
  const now = nowFn()

  const user = await repo.getUser(userId)
  if (!user) return null

  const [checkins, routeBooks, worksVisited, pointsVisited, notesPublished] = await Promise.all([
    repo.listCheckins(userId),
    repo.listRouteBooks(userId),
    repo.countDistinctWorksVisited(userId),
    repo.countDistinctPointsVisited(userId),
    repo.countNotesPublished(userId),
  ])

  const stats = buildStats({ checkins, routeBooks, worksVisited, pointsVisited })
  const currentTrip = pickCurrentTrip(routeBooks)
  const prefectures = buildPrefectures(checkins)
  const pinsForMap = buildPins(checkins)
  const tripsForTimeline = buildTimeline(routeBooks)
  const workProgress = buildWorkProgress(checkins)
  const recentPhotos = buildRecentPhotos(checkins)
  const worksCompleted = workProgress.filter((w) => w.percent === 100).length
  const prefectureCount = prefectures.length

  const achievementInput = {
    totalCheckins: stats.totalCheckins,
    totalKilometers: stats.totalKilometers,
    worksCompleted,
    prefectureCount,
    springCheckin: hasSpringCheckin(checkins),
    highSyncRateComposite: false,
    notesPublished,
  }
  const achievements = evaluateAchievements(achievementInput, now)
  const nextAchievement = pickNextAchievement(achievementInput, now)

  return {
    user: {
      id: user.id,
      name: user.name ?? '巡礼者',
      image: user.image,
      bio: user.bio,
      createdAt: user.createdAt,
      journalNumber: deriveJournalNumber(user.id),
      daysSinceJoined: daysBetween(user.createdAt, now),
    },
    stats,
    currentTrip,
    prefectures,
    pinsForMap,
    recentNotes: [],
    tripsForTimeline,
    workProgress,
    achievements,
    nextAchievement,
    travelModeBreakdown: DEFAULT_TRAVEL_MODES,
    recentPhotos,
  }
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return Math.max(Math.floor(ms / 86_400_000), 0)
}

function deriveJournalNumber(userId: string): string {
  const digits = userId.replace(/[^0-9]/g, '').padStart(4, '0').slice(-4)
  return `#${digits || '0001'}`
}

function buildStats(args: {
  checkins: JournalCheckinRow[]
  routeBooks: JournalRouteBookRow[]
  worksVisited: number
  pointsVisited: number
}): JournalSnapshot['stats'] {
  const trips = args.routeBooks.filter((r) => r.status === 'completed' || r.status === 'in_progress')
  return {
    worksVisited: args.worksVisited,
    pointsVisited: args.pointsVisited,
    totalCheckins: args.checkins.length,
    totalKilometers: estimateKilometers(args.checkins),
    totalTrips: trips.length,
  }
}

function estimateKilometers(checkins: JournalCheckinRow[]): number {
  let total = 0
  const sorted = [...checkins].sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime())
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (a.geoLat == null || a.geoLng == null || b.geoLat == null || b.geoLng == null) continue
    total += haversineKm(a.geoLat, a.geoLng, b.geoLat, b.geoLng)
  }
  return Math.round(total)
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function pickCurrentTrip(rbs: JournalRouteBookRow[]): JournalSnapshot['currentTrip'] {
  const inProgress = rbs.find((r) => r.status === 'in_progress')
  const fallback = [...rbs]
    .filter((r) => r.status === 'draft')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
  const picked = inProgress ?? fallback
  if (!picked) return null
  const meta = picked.metadata as Record<string, unknown> | null
  const departureRaw = meta && typeof meta.departureDate === 'string' ? meta.departureDate : null
  return {
    id: picked.id,
    title: picked.title,
    pointCount: picked.pointCount,
    durationDays: typeof meta?.durationDays === 'number' ? (meta.durationDays as number) : null,
    departureDate: departureRaw ? new Date(departureRaw) : null,
    status: picked.status === 'in_progress' ? 'in_progress' : 'preparing',
  }
}

function buildPrefectures(checkins: JournalCheckinRow[]): JournalSnapshot['prefectures'] {
  const counts = new Map<string, number>()
  for (const c of checkins) {
    if (!c.prefectureZh) continue
    counts.set(c.prefectureZh, (counts.get(c.prefectureZh) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([nameZh, pointCount]) => ({ nameZh, pointCount }))
    .sort((a, b) => b.pointCount - a.pointCount || a.nameZh.localeCompare(b.nameZh))
}

function buildPins(checkins: JournalCheckinRow[]): JournalSnapshot['pinsForMap'] {
  return checkins
    .filter((c) => c.geoLat != null && c.geoLng != null)
    .map((c) => ({ lat: c.geoLat as number, lng: c.geoLng as number, isMostRecent: c.isMostRecent }))
}

function buildTimeline(rbs: JournalRouteBookRow[]): JournalSnapshot['tripsForTimeline'] {
  return rbs.map((r) => {
    const meta = r.metadata as Record<string, unknown> | null
    const departureRaw = meta && typeof meta.departureDate === 'string' ? meta.departureDate : null
    const start = departureRaw ? new Date(departureRaw) : r.createdAt
    const monthStart = start.getUTCMonth() + 1
    const endMonth = monthStart
    const status: 'completed' | 'in_progress' | 'planned' =
      r.status === 'completed' ? 'completed' : r.status === 'in_progress' ? 'in_progress' : 'planned'
    return {
      id: r.id,
      title: r.title,
      workTitle: r.workTitle,
      location: r.locationZh,
      monthStart,
      monthEnd: endMonth,
      status,
    }
  })
}

function buildWorkProgress(checkins: JournalCheckinRow[]): JournalSnapshot['workProgress'] {
  type Acc = { workId: string; workTitle: string; visited: Set<string>; total: number }
  const byWork = new Map<string, Acc>()
  for (const c of checkins) {
    if (!c.workId || !c.workTitle) continue
    const entry = byWork.get(c.workId) ?? {
      workId: c.workId,
      workTitle: c.workTitle,
      visited: new Set<string>(),
      total: c.totalPointsForWork ?? 0,
    }
    entry.visited.add(c.pointId)
    if (c.totalPointsForWork != null) entry.total = Math.max(entry.total, c.totalPointsForWork)
    byWork.set(c.workId, entry)
  }
  return [...byWork.values()]
    .map((w) => {
      const visitedPoints = w.visited.size
      const totalPoints = Math.max(w.total, visitedPoints)
      const percent = totalPoints === 0 ? 0 : Math.round((visitedPoints / totalPoints) * 100)
      return { workTitle: w.workTitle, visitedPoints, totalPoints, percent }
    })
    .sort((a, b) => b.percent - a.percent || a.workTitle.localeCompare(b.workTitle))
}

function buildRecentPhotos(checkins: JournalCheckinRow[]): JournalSnapshot['recentPhotos'] {
  return [...checkins]
    .filter((c) => c.photoUrl)
    .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime())
    .slice(0, 4)
    .map((c) => ({
      id: c.pointId,
      photoUrl: c.photoUrl as string,
      placeName: c.placeName,
      workTitle: c.workTitle,
      takenAt: c.checkedInAt,
    }))
}

function hasSpringCheckin(checkins: JournalCheckinRow[]): boolean {
  return checkins.some((c) => {
    const m = c.checkedInAt.getUTCMonth() + 1
    return m >= 3 && m <= 5
  })
}
