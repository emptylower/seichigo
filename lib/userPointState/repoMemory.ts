import crypto from 'node:crypto'
import type { UserPointState, UserPointStateRepo, UserPointStateValue, UpsertUserPointStateOpts, ListByUserFilters } from './repo'

type Options = {
  now?: () => Date
  idFactory?: () => string
  pointBangumiMap?: Map<string, number>
}

export class InMemoryUserPointStateRepo implements UserPointStateRepo {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly pointBangumiMap: Map<string, number>
  private readonly byId = new Map<string, UserPointState>()
  private readonly byUserPoint = new Map<string, string>() // `${userId}:${pointId}` -> id

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
    this.pointBangumiMap = options?.pointBangumiMap ?? new Map()
  }

  private userPointKey(userId: string, pointId: string): string {
    return `${userId}:${pointId}`
  }

  async upsert(userId: string, pointId: string, state: UserPointStateValue, opts?: UpsertUserPointStateOpts): Promise<UserPointState> {
    const key = this.userPointKey(userId, pointId)
    const existingId = this.byUserPoint.get(key)
    const now = this.now()

    if (existingId) {
      const existing = this.byId.get(existingId)
      if (existing) {
        existing.state = state
        if (opts?.checkedInAt !== undefined) existing.checkedInAt = opts.checkedInAt ?? null
        if (opts?.gpsVerified !== undefined) existing.gpsVerified = opts.gpsVerified
        if (opts?.photoUrl !== undefined) existing.photoUrl = opts.photoUrl ?? null
        existing.updatedAt = now
        this.byId.set(existingId, { ...existing })
        return this.byId.get(existingId)!
      }
    }

    const newState: UserPointState = {
      id: this.idFactory(),
      userId,
      pointId,
      state,
      checkedInAt: opts?.checkedInAt ?? null,
      gpsVerified: opts?.gpsVerified ?? false,
      photoUrl: opts?.photoUrl ?? null,
      createdAt: now,
      updatedAt: now,
    }

    this.byId.set(newState.id, newState)
    this.byUserPoint.set(key, newState.id)
    return newState
  }

  async delete(userId: string, pointId: string): Promise<boolean> {
    const key = this.userPointKey(userId, pointId)
    const id = this.byUserPoint.get(key)
    if (!id) return false

    this.byId.delete(id)
    this.byUserPoint.delete(key)
    return true
  }

  async listByUser(userId: string, filters?: ListByUserFilters): Promise<UserPointState[]> {
    let results = Array.from(this.byId.values()).filter((s) => s.userId === userId)

    if (filters?.state) {
      results = results.filter((s) => s.state === filters.state)
    }

    if (filters?.bangumiId !== undefined) {
      results = results.filter((s) => {
        const bangumiId = this.pointBangumiMap.get(s.pointId)
        return bangumiId === filters.bangumiId
      })
    }

    return results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async getByUserAndPoint(userId: string, pointId: string): Promise<UserPointState | null> {
    const key = this.userPointKey(userId, pointId)
    const id = this.byUserPoint.get(key)
    if (!id) return null
    return this.byId.get(id) ?? null
  }

  async countByBangumi(userId: string, bangumiId: number): Promise<number> {
    const states = Array.from(this.byId.values()).filter((s) => {
      if (s.userId !== userId) return false
      const pointBangumiId = this.pointBangumiMap.get(s.pointId)
      return pointBangumiId === bangumiId
    })
    return states.length
  }
}
