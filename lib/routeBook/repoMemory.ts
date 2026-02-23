import crypto from 'node:crypto'
import {
  SORTED_ZONE_LIMIT,
  SortedZoneLimitError,
  type RouteBook,
  type RouteBookPoint,
  type RouteBookPointListFilters,
  type RouteBookPointRef,
  type RouteBookRepo,
  type RouteBookStatus,
  type RouteBookUpdateInput,
  type RouteBookWithPoints,
  type RouteBookZone,
} from './repo'

type Options = {
  now?: () => Date
  idFactory?: () => string
  pointBangumiMap?: Map<string, number>
}

export class InMemoryRouteBookRepo implements RouteBookRepo {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly pointBangumiMap: Map<string, number>

  private readonly byId = new Map<string, RouteBook>()
  private readonly pointsByBookId = new Map<string, Map<string, RouteBookPoint>>()

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
    this.pointBangumiMap = options?.pointBangumiMap ?? new Map()
  }

  private requireOwnedRouteBook(routeBookId: string, userId: string): RouteBook {
    const book = this.byId.get(routeBookId)
    if (!book || book.userId !== userId) throw new Error('RouteBook not found')
    return book
  }

  private getPointsMap(routeBookId: string): Map<string, RouteBookPoint> {
    const existing = this.pointsByBookId.get(routeBookId)
    if (existing) return existing
    const created = new Map<string, RouteBookPoint>()
    this.pointsByBookId.set(routeBookId, created)
    return created
  }

  private touch(routeBookId: string): void {
    const book = this.byId.get(routeBookId)
    if (!book) return
    book.updatedAt = this.now()
    this.byId.set(routeBookId, { ...book })
  }

  private listPoints(routeBookId: string): RouteBookPoint[] {
    return Array.from(this.getPointsMap(routeBookId).values()).sort((a, b) => {
      if (a.zone !== b.zone) return a.zone.localeCompare(b.zone)
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.createdAt.getTime() - b.createdAt.getTime()
    })
  }

  private countByZone(routeBookId: string, zone: RouteBookZone): number {
    let count = 0
    for (const p of this.getPointsMap(routeBookId).values()) {
      if (p.zone === zone) count++
    }
    return count
  }

  private nextSortOrder(routeBookId: string, zone: RouteBookZone): number {
    let max = -1
    for (const p of this.getPointsMap(routeBookId).values()) {
      if (p.zone !== zone) continue
      if (p.sortOrder > max) max = p.sortOrder
    }
    return max + 1
  }

  private compactOrders(routeBookId: string): void {
    const map = this.getPointsMap(routeBookId)
    const zones: RouteBookZone[] = ['sorted', 'unsorted']

    for (const zone of zones) {
      const list = Array.from(map.values())
        .filter((p) => p.zone === zone)
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
          if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime()
          return a.id.localeCompare(b.id)
        })

      for (let i = 0; i < list.length; i++) {
        const p = list[i]
        if (p.sortOrder === i) continue
        map.set(p.pointId, { ...p, sortOrder: i })
      }
    }
  }

  async create(userId: string, title: string, status: RouteBookStatus): Promise<RouteBook> {
    const now = this.now()
    const book: RouteBook = {
      id: this.idFactory(),
      userId,
      title,
      status,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    }
    this.byId.set(book.id, book)
    return book
  }

  async update(id: string, userId: string, data: RouteBookUpdateInput): Promise<RouteBook | null> {
    const existing = this.byId.get(id)
    if (!existing || existing.userId !== userId) return null

    const next: RouteBook = { ...existing }
    if (data.title != null) next.title = data.title
    if (data.status != null) next.status = data.status
    if (data.metadata !== undefined) next.metadata = data.metadata
    next.updatedAt = this.now()

    this.byId.set(id, next)
    return next
  }

  async delete(id: string, userId: string): Promise<RouteBook | null> {
    const existing = this.byId.get(id)
    if (!existing || existing.userId !== userId) return null

    this.byId.delete(id)
    this.pointsByBookId.delete(id)
    return existing
  }

  async getById(id: string, userId: string): Promise<RouteBookWithPoints | null> {
    const existing = this.byId.get(id)
    if (!existing || existing.userId !== userId) return null

    return {
      ...existing,
      points: this.listPoints(id),
    }
  }

  async listByUser(userId: string, filters?: { status?: RouteBookStatus }): Promise<RouteBook[]> {
    return Array.from(this.byId.values())
      .filter((b) => b.userId === userId)
      .filter((b) => !filters?.status || b.status === filters.status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async addPoint(routeBookId: string, userId: string, pointId: string, zone: RouteBookZone): Promise<RouteBookPoint> {
    this.requireOwnedRouteBook(routeBookId, userId)

    const map = this.getPointsMap(routeBookId)
    const existing = map.get(pointId)
    if (existing) return existing

    if (zone === 'sorted') {
      const sortedCount = this.countByZone(routeBookId, 'sorted')
      if (sortedCount >= SORTED_ZONE_LIMIT) throw new SortedZoneLimitError(routeBookId)
    }

    const createdAt = this.now()
    const point: RouteBookPoint = {
      id: this.idFactory(),
      routeBookId,
      pointId,
      zone,
      sortOrder: this.nextSortOrder(routeBookId, zone),
      createdAt,
    }
    map.set(pointId, point)

    this.compactOrders(routeBookId)
    this.touch(routeBookId)

    return map.get(pointId) ?? point
  }

  async removePoint(routeBookId: string, userId: string, pointId: string): Promise<boolean> {
    this.requireOwnedRouteBook(routeBookId, userId)

    const map = this.getPointsMap(routeBookId)
    const existed = map.delete(pointId)
    if (!existed) return false

    this.compactOrders(routeBookId)
    this.touch(routeBookId)

    return true
  }

  async reorderPoints(routeBookId: string, userId: string, pointIds: string[]): Promise<RouteBookPoint[]> {
    this.requireOwnedRouteBook(routeBookId, userId)

    const map = this.getPointsMap(routeBookId)
    const sortedPoints = Array.from(map.values())
      .filter((p) => p.zone === 'sorted')
      .sort((a, b) => a.sortOrder - b.sortOrder)

    const existingIds = new Set(sortedPoints.map((p) => p.pointId))
    const seen = new Set<string>()
    const head: string[] = []
    for (const id of pointIds) {
      if (!existingIds.has(id)) continue
      if (seen.has(id)) continue
      seen.add(id)
      head.push(id)
    }

    const tail = sortedPoints.map((p) => p.pointId).filter((id) => !seen.has(id))
    const next = [...head, ...tail]
    if (next.length > SORTED_ZONE_LIMIT) throw new SortedZoneLimitError(routeBookId)

    for (let i = 0; i < next.length; i++) {
      const id = next[i]
      const p = map.get(id)
      if (!p || p.zone !== 'sorted') continue
      map.set(id, { ...p, sortOrder: i })
    }

    this.compactOrders(routeBookId)
    this.touch(routeBookId)

    return this.listPoints(routeBookId).filter((p) => p.zone === 'sorted')
  }

  async movePointToZone(routeBookId: string, userId: string, pointId: string, zone: RouteBookZone): Promise<RouteBookPoint | null> {
    this.requireOwnedRouteBook(routeBookId, userId)

    const map = this.getPointsMap(routeBookId)
    const existing = map.get(pointId)
    if (!existing) return null
    if (existing.zone === zone) return existing

    if (zone === 'sorted') {
      const sortedCount = this.countByZone(routeBookId, 'sorted')
      if (sortedCount >= SORTED_ZONE_LIMIT) throw new SortedZoneLimitError(routeBookId)
    }

    const updated: RouteBookPoint = {
      ...existing,
      zone,
      sortOrder: this.nextSortOrder(routeBookId, zone),
    }
    map.set(pointId, updated)

    this.compactOrders(routeBookId)
    this.touch(routeBookId)

    return map.get(pointId) ?? updated
  }

  async isPointInAnyRouteBook(userId: string, pointId: string): Promise<boolean> {
    for (const book of this.byId.values()) {
      if (book.userId !== userId) continue
      const points = this.pointsByBookId.get(book.id)
      if (!points) continue
      if (points.has(pointId)) return true
    }
    return false
  }

  async listPointRefsByUser(userId: string, filters?: RouteBookPointListFilters): Promise<RouteBookPointRef[]> {
    const merged = new Map<string, Date>()

    for (const book of this.byId.values()) {
      if (book.userId !== userId) continue
      const points = this.pointsByBookId.get(book.id)
      if (!points) continue

      for (const point of points.values()) {
        if (filters?.bangumiId !== undefined) {
          const bangumiId = this.pointBangumiMap.get(point.pointId)
          if (bangumiId !== filters.bangumiId) continue
        }

        const seen = merged.get(point.pointId)
        if (!seen || seen.getTime() < book.updatedAt.getTime()) {
          merged.set(point.pointId, book.updatedAt)
        }
      }
    }

    return Array.from(merged.entries())
      .map(([pointId, updatedAt]) => ({ pointId, updatedAt }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }
}
