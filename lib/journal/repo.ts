// lib/journal/repo.ts

export type JournalUserRow = {
  id: string
  name: string | null
  image: string | null
  bio: string | null
  createdAt: Date
}

export type JournalCheckinRow = {
  pointId: string
  geoLat: number | null
  geoLng: number | null
  prefectureZh: string | null
  workTitle: string | null
  workId: string | null
  totalPointsForWork: number | null
  photoUrl: string | null
  placeName: string
  checkedInAt: Date
  isMostRecent: boolean
}

export type JournalRouteBookRow = {
  id: string
  title: string
  status: string
  metadata: unknown
  pointCount: number
  createdAt: Date
  updatedAt: Date
  workTitle: string | null
  locationZh: string | null
}

export type JournalReadRepo = {
  getUser(userId: string): Promise<JournalUserRow | null>
  listCheckins(userId: string): Promise<JournalCheckinRow[]>
  listRouteBooks(userId: string): Promise<JournalRouteBookRow[]>
  countDistinctWorksVisited(userId: string): Promise<number>
  countDistinctPointsVisited(userId: string): Promise<number>
  countNotesPublished(userId: string): Promise<number>
}
