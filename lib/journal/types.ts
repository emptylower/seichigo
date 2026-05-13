// lib/journal/types.ts

export type JournalSnapshot = {
  user: {
    id: string
    name: string
    image: string | null
    bio: string | null
    createdAt: Date
    journalNumber: string // e.g. "#0042"，由 user.id 派生
    daysSinceJoined: number // 从 createdAt 到 now 的整天数
  }

  stats: {
    worksVisited: number
    pointsVisited: number
    totalCheckins: number
    totalKilometers: number
    totalTrips: number
  }

  currentTrip: {
    id: string
    title: string
    pointCount: number
    durationDays: number | null
    departureDate: Date | null
    status: 'preparing' | 'in_progress'
  } | null

  prefectures: Array<{
    nameZh: string
    pointCount: number
  }>

  pinsForMap: Array<{
    lat: number
    lng: number
    isMostRecent: boolean
  }>

  recentNotes: Array<{
    id: string
    title: string
    bodyPreview: string
    publishedAt: Date
    location: string | null
    tags: string[]
  }>

  tripsForTimeline: Array<{
    id: string
    title: string
    workTitle: string | null
    location: string | null
    monthStart: number // 1-12
    monthEnd: number // 1-12
    status: 'completed' | 'in_progress' | 'planned'
  }>

  workProgress: Array<{
    workTitle: string
    visitedPoints: number
    totalPoints: number
    percent: number // 0-100, integer
  }>

  achievements: ReadonlyArray<{
    id: string
    label: string
    sub: string
    color: AchievementColor
    unlocked: boolean
    unlockedAt: Date | null
  }>

  nextAchievement: {
    label: string
    progress: number
    target: number
  } | null

  travelModeBreakdown: ReadonlyArray<{
    mode: 'train' | 'bus' | 'car' | 'walk'
    percent: number
  }>

  recentPhotos: ReadonlyArray<{
    id: string
    photoUrl: string
    placeName: string
    workTitle: string | null
    takenAt: Date
  }>
}

export type AchievementColor =
  | 'seal-red'
  | 'ink'
  | 'amber'
  | 'emerald'
  | 'sky'
  | 'rose'
  | 'slate'
  | 'stone'
