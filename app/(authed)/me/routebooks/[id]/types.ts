import type { ItemKind, PlaceKind, RouteBookStatus, TravelMode } from '@/lib/routeBook/repo'
import type { Leg, LegStop } from '@/lib/routeBook/legs'

export type { ItemKind, PlaceKind, RouteBookStatus, TravelMode }

/** 与 lib/routeBook/repo.ts 同形的前端 DTO（Date → ISO string） */
export type DayRecord = {
  id: string
  routeBookId: string
  dayIndex: number
  date: string | null
  title: string | null
  defaultTravelMode: TravelMode
}

export type ItemRecord = {
  id: string
  routeBookId: string
  dayId: string | null
  sortOrder: number
  kind: ItemKind
  pointId: string | null
  placeId: string | null
  title: string | null
  note: string | null
  timeStart: string | null
  timeEnd: string | null
  locked: boolean
  icon: string | null
  color: string | null
  legMode: TravelMode | null
  payload: unknown | null
  createdAt: string
}

export type PlaceRecord = {
  id: string
  routeBookId: string
  kind: PlaceKind
  title: string
  address: string | null
  lat: number
  lng: number
  note: string | null
  createdAt: string
}

export type LodgingRecord = {
  id: string
  routeBookId: string
  placeId: string
  fromDayIndex: number
  toDayIndex: number
  checkIn: string | null
  checkOut: string | null
  note: string | null
}

export type RouteBookDetail = {
  id: string
  title: string
  status: RouteBookStatus
  metadata: unknown | null
  startDate: string | null
  dayCount: number
  createdAt: string
  updatedAt: string
  days: DayRecord[]
  items: ItemRecord[]
  places: PlaceRecord[]
  lodgings: LodgingRecord[]
}

export type RouteBookSummary = {
  id: string
  title: string
  status: RouteBookStatus
  metadata: unknown | null
  createdAt: string
  updatedAt: string
}

export type PointPoolItem = {
  id: string
  pointId: string
  createdAt: string
  updatedAt: string
}

export type PointPreview = {
  title: string
  subtitle: string
  image: string | null
  geo: [number, number] | null
}

export type BangumiResponse = {
  card?: {
    title?: string
    titleZh?: string | null
    cover?: string | null
  }
  points?: Array<{
    id: string
    name?: string | null
    nameZh?: string | null
    image?: string | null
    geo?: [number, number] | null
  }>
}

export type DetailResponse =
  | { ok: true; routeBook?: RouteBookDetail; item?: RouteBookDetail }
  | { error: string }

export type RouteBookListResponse =
  | { ok: true; items: RouteBookSummary[] }
  | { error: string }

export type NavMode = 'transit' | 'driving'

/** 当天段数据（与 lib/routeBook/legs.ts 的 Leg/LegStop 同形） */
export type DayLeg = Leg
export type DayLegStop = LegStop
export type DayLegsResult = {
  stops: DayLegStop[]
  legs: DayLeg[]
  staleTransitItemIds: string[]
}

export const DAY_ITEM_LIMIT = 25
export const PREVIEW_POINT_BATCH_SIZE = 28
export const PREVIEW_FETCH_IDLE_TIMEOUT = 1200

export const STATUS_LABEL: Record<RouteBookStatus, string> = {
  draft: '草稿',
  in_progress: '进行中',
  completed: '已完成',
}

export const STATUS_STYLE: Record<RouteBookStatus, string> = {
  draft: 'bg-white/75 text-slate-700',
  in_progress: 'bg-sky-500/85 text-white',
  completed: 'bg-emerald-500/85 text-white',
}

export const STATUS_ACTION_CLASS: Record<RouteBookStatus, string> = {
  draft: 'bg-blue-500 hover:bg-blue-600 text-white',
  in_progress: 'bg-green-500 hover:bg-green-600 text-white',
  completed: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
}

export const NAV_MODE_LABEL: Record<NavMode, string> = {
  transit: '公交 + 步行',
  driving: '驾车',
}

export const NAV_MODE_PARAM: Record<NavMode, 'transit' | 'driving'> = {
  transit: 'transit',
  driving: 'driving',
}

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  transit: '公共交通',
  walking: '步行',
  driving: '驾车',
}

export const DRAG_SAFE_CONTROL_PROPS = {
  onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onTouchStart: (event: { stopPropagation: () => void }) => event.stopPropagation(),
}

export const ITEM_DND_PREFIX = 'item:'
export const POOL_DND_PREFIX = 'pool:'
export const MARKER_DND_PREFIX = 'marker:'
export const DAY_DROP_PREFIX = 'day:'
export const UNASSIGNED_DROP_ID = 'day:unassigned'

export const POINT_FALLBACK_GRADIENTS = [
  'from-sky-500/85 via-cyan-400/80 to-brand-300/80',
  'from-brand-500/85 via-rose-400/80 to-orange-300/75',
  'from-violet-500/80 via-fuchsia-400/75 to-brand-400/75',
  'from-emerald-500/80 via-teal-400/75 to-cyan-300/75',
] as const
