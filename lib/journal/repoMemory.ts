import type {
  JournalCheckinRow,
  JournalReadRepo,
  JournalRouteBookRow,
  JournalUserRow,
} from './repo'

export type SeedData = {
  users: JournalUserRow[]
  checkins: Array<JournalCheckinRow & { userId: string }>
  routeBooks: Array<JournalRouteBookRow & { userId: string }>
  worksVisited: number
  pointsVisited: number
  notesPublished: number
}

export class InMemoryJournalReadRepo implements JournalReadRepo {
  constructor(private readonly seed: SeedData) {}

  async getUser(userId: string): Promise<JournalUserRow | null> {
    return this.seed.users.find((u) => u.id === userId) ?? null
  }

  async listCheckins(userId: string): Promise<JournalCheckinRow[]> {
    return this.seed.checkins
      .filter((c) => c.userId === userId)
      .map(({ userId: _drop, ...rest }) => rest)
  }

  async listRouteBooks(userId: string): Promise<JournalRouteBookRow[]> {
    return this.seed.routeBooks
      .filter((r) => r.userId === userId)
      .map(({ userId: _drop, ...rest }) => rest)
  }

  async countDistinctWorksVisited(userId: string): Promise<number> {
    return this.seed.users.some((u) => u.id === userId) ? this.seed.worksVisited : 0
  }

  async countDistinctPointsVisited(userId: string): Promise<number> {
    return this.seed.users.some((u) => u.id === userId) ? this.seed.pointsVisited : 0
  }

  async countNotesPublished(userId: string): Promise<number> {
    return this.seed.users.some((u) => u.id === userId) ? this.seed.notesPublished : 0
  }
}
