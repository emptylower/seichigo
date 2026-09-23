import type { ItemKind, PlaceKind, RouteBookStatus, TravelMode } from '../types'

export type CreateItemInput = {
  kind: ItemKind
  pointId?: string
  placeId?: string
  title?: string
  note?: string
  timeStart?: string
}

export type UpdateItemInput = {
  title?: string | null
  note?: string | null
  timeStart?: string | null
  timeEnd?: string | null
  locked?: boolean
  icon?: string | null
  color?: string | null
  legMode?: TravelMode | null
}

export type PatchBookInput = {
  title?: string
  status?: RouteBookStatus
  startDate?: string | null
  dayCount?: number
}

export type PlaceInput = {
  kind: PlaceKind
  title: string
  address?: string | null
  lat: number
  lng: number
  note?: string | null
}

export type LodgingInput = {
  placeId: string
  fromDayIndex: number
  toDayIndex: number
  checkIn?: string | null
  checkOut?: string | null
  note?: string | null
}
