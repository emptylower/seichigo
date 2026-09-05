import type { Prisma } from '@prisma/client'
import type { RouteBookStatus } from './repo'

export type RouteBookExportPointInput = {
  pointId: string
  zone: string
  sortOrder: number
}

export type RouteBookExportCreateInput = {
  userId: string
  title: string
  status: RouteBookStatus
  metadata: Prisma.InputJsonValue
  points: RouteBookExportPointInput[]
}

export interface RouteBookExportStore {
  findBySourcePlanId(userId: string, sourcePlanId: string): Promise<{ id: string } | null>
  createWithPoints(input: RouteBookExportCreateInput): Promise<{ id: string }>
}
