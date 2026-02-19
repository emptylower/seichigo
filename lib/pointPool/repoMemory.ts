import crypto from 'node:crypto'
import type { ListPointPoolFilters, PointPoolRepo, UserPointPoolItem } from '@/lib/pointPool/repo'

type Options = {
  now?: () => Date
  idFactory?: () => string
  pointBangumiMap?: Map<string, number>
}

export class InMemoryPointPoolRepo implements PointPoolRepo {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly pointBangumiMap: Map<string, number>
  private readonly byId = new Map<string, UserPointPoolItem>()
  private readonly byUserPoint = new Map<string, string>()

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
    this.pointBangumiMap = options?.pointBangumiMap ?? new Map()
  }

  private key(userId: string, pointId: string): string {
    return `${userId}:${pointId}`
  }

  async upsert(userId: string, pointId: string): Promise<UserPointPoolItem> {
    const key = this.key(userId, pointId)
    const now = this.now()
    const existingId = this.byUserPoint.get(key)

    if (existingId) {
      const existing = this.byId.get(existingId)
      if (existing) {
        const next = { ...existing, updatedAt: now }
        this.byId.set(existingId, next)
        return next
      }
    }

    const created: UserPointPoolItem = {
      id: this.idFactory(),
      userId,
      pointId,
      createdAt: now,
      updatedAt: now,
    }

    this.byId.set(created.id, created)
    this.byUserPoint.set(key, created.id)

    return created
  }

  async delete(userId: string, pointId: string): Promise<boolean> {
    const key = this.key(userId, pointId)
    const id = this.byUserPoint.get(key)
    if (!id) return false

    this.byUserPoint.delete(key)
    this.byId.delete(id)
    return true
  }

  async listByUser(userId: string, filters?: ListPointPoolFilters): Promise<UserPointPoolItem[]> {
    let rows = Array.from(this.byId.values()).filter((item) => item.userId === userId)

    if (filters?.bangumiId !== undefined) {
      rows = rows.filter((item) => this.pointBangumiMap.get(item.pointId) === filters.bangumiId)
    }

    return rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async has(userId: string, pointId: string): Promise<boolean> {
    return this.byUserPoint.has(this.key(userId, pointId))
  }
}
