import type { Prisma } from '@prisma/client'

export const SORTED_ZONE_LIMIT = 25

export type RouteBookStatus = 'draft' | 'in_progress' | 'completed'
export type RouteBookZone = 'unsorted' | 'sorted'

export type RouteBook = {
  id: string
  userId: string
  title: string
  status: RouteBookStatus
  metadata: Prisma.JsonValue | null
  createdAt: Date
  updatedAt: Date
}

export type RouteBookPoint = {
  id: string
  routeBookId: string
  pointId: string
  sortOrder: number
  zone: RouteBookZone
  createdAt: Date
}

export type RouteBookWithPoints = RouteBook & {
  points: RouteBookPoint[]
}

export type RouteBookUpdateInput = {
  title?: string
  status?: RouteBookStatus
  metadata?: Prisma.JsonValue | null
}

export type RouteBookListFilters = {
  status?: RouteBookStatus
}

export type RouteBookPointListFilters = {
  bangumiId?: number
}

export type RouteBookPointRef = {
  pointId: string
  updatedAt: Date
}

export interface RouteBookRepo {
  create(userId: string, title: string, status: RouteBookStatus): Promise<RouteBook>
  update(id: string, userId: string, data: RouteBookUpdateInput): Promise<RouteBook | null>
  delete(id: string, userId: string): Promise<RouteBook | null>
  getById(id: string, userId: string): Promise<RouteBookWithPoints | null>
  listByUser(userId: string, filters?: RouteBookListFilters): Promise<RouteBook[]>

  addPoint(routeBookId: string, userId: string, pointId: string, zone: RouteBookZone): Promise<RouteBookPoint>
  removePoint(routeBookId: string, userId: string, pointId: string): Promise<boolean>
  reorderPoints(routeBookId: string, userId: string, pointIds: string[]): Promise<RouteBookPoint[]>
  movePointToZone(routeBookId: string, userId: string, pointId: string, zone: RouteBookZone): Promise<RouteBookPoint | null>
  isPointInAnyRouteBook(userId: string, pointId: string): Promise<boolean>
  listPointRefsByUser(userId: string, filters?: RouteBookPointListFilters): Promise<RouteBookPointRef[]>
}

export class SortedZoneLimitError extends Error {
  readonly routeBookId: string
  readonly limit: number

  constructor(routeBookId: string, limit = SORTED_ZONE_LIMIT) {
    super('Sorted zone point limit reached')
    this.name = 'SortedZoneLimitError'
    this.routeBookId = routeBookId
    this.limit = limit
  }
}
