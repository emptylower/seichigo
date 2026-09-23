import type { Prisma } from '@prisma/client'
import type { ItemKind, PlaceKind, RouteBookStatus } from './repo'

export type ExportDay = { dayIndex: number; date: Date | null; title: string | null }
export type ExportPlace = {
  tempId: string
  kind: PlaceKind
  title: string
  address: string | null
  lat: number
  lng: number
  /** plan agent 外部地点的谷歌 placeId（缺省为 null） */
  googlePlaceId?: string | null
}
/** id 由映射层用 crypto.randomUUID() 预生成，transit 的 payload.transitBetween 才能引用相邻条目 */
export type ExportItem = {
  id: string
  dayIndex: number
  sortOrder: number
  kind: ItemKind
  pointId?: string
  placeTempId?: string
  title?: string
  note?: string
  timeStart?: string
  timeEnd?: string
  locked?: boolean
  payload?: Prisma.InputJsonValue
}
export type ExportLodging = { placeTempId: string; fromDayIndex: number; toDayIndex: number }

export type RouteBookExportCreateInput = {
  userId: string
  title: string
  status: RouteBookStatus
  metadata: Prisma.InputJsonValue
  startDate: Date | null
  dayCount: number
  days: ExportDay[]
  places: ExportPlace[]
  items: ExportItem[]
  lodgings: ExportLodging[]
}

export interface RouteBookExportStore {
  findBySourcePlanId(userId: string, sourcePlanId: string): Promise<{ id: string } | null>
  createFromPlan(input: RouteBookExportCreateInput): Promise<{ id: string }>
}
