import type { RouteBookStatus, RouteBookZone } from '@/lib/routeBook/repo'

export type { RouteBookStatus, RouteBookZone }

export type PointRecord = {
  id: string
  routeBookId: string
  pointId: string
  sortOrder: number
  zone: RouteBookZone
  createdAt: string
}

export type PointPoolItem = {
  id: string
  pointId: string
  createdAt: string
  updatedAt: string
}

export type RouteBookDetail = {
  id: string
  title: string
  status: RouteBookStatus
  metadata: unknown | null
  createdAt: string
  updatedAt: string
  points: PointRecord[]
}

export type DetailResponse =
  | { ok: true; routeBook?: RouteBookDetail; item?: RouteBookDetail }
  | { error: string }

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

export type NavMode = 'transit' | 'driving'

export const SORTED_LIMIT = 25
export const PREVIEW_POINT_BATCH_SIZE = 28
export const PREVIEW_FETCH_IDLE_TIMEOUT = 1200
export const ROUTE_PREVIEW_URL_SYNC_DEBOUNCE_MS = 900

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

export const DRAG_SAFE_CONTROL_PROPS = {
  onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onTouchStart: (event: { stopPropagation: () => void }) => event.stopPropagation(),
}

export const SORTED_ZONE_ID = 'zone:sorted'
export const UNSORTED_ZONE_ID = 'zone:unsorted'
export const SORTED_DND_PREFIX = 'sorted:'
export const UNSORTED_DND_PREFIX = 'unsorted:'
export const POOL_DND_PREFIX = 'pool:'

export const POINT_FALLBACK_GRADIENTS = [
  'from-sky-500/85 via-cyan-400/80 to-brand-300/80',
  'from-brand-500/85 via-rose-400/80 to-orange-300/75',
  'from-violet-500/80 via-fuchsia-400/75 to-brand-400/75',
  'from-emerald-500/80 via-teal-400/75 to-cyan-300/75',
] as const
