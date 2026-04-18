type MetricValue = number | string

export type FirstViewMetricSink = {
  current: Record<string, MetricValue>
}

export type FirstViewSlotType =
  | 'cover-avatar'
  | 'point-thumbnail'
  | 'point-preview'
  | 'dom-image'

export type FirstViewSlotOwner = 'warmup' | 'viewport-loader' | 'dom-image'
export type FirstViewSlotSettleState = 'visible' | 'fallback'
export type FirstViewAnchor = 'map_shell_ready' | 'bootstrap_ready'

type FirstViewSlotRecord = {
  slotKey: string
  slotType: FirstViewSlotType
  src: string
  owner: FirstViewSlotOwner
  requestStartedAt: number | null
  settledAt: number | null
  settledState: FirstViewSlotSettleState | null
}

type FirstViewDebugStore = {
  anchors: Partial<Record<FirstViewAnchor, number>>
  slots: Record<string, FirstViewSlotRecord>
}

const GLOBAL_STORE_KEY = '__SEICHIGO_MAP_FIRST_VIEW__'
const SESSION_ID_KEY = 'first_view_session_id'
const FIRST_VIEW_MOBILE_MAX_WIDTH = 767
let firstViewSessionCounter = 0

export const FIRST_VIEW_DESKTOP_SLOT_COUNT = 20
export const FIRST_VIEW_MOBILE_SLOT_COUNT = 12
export const FIRST_VIEW_CANARY_SPEC_PATH = '.omx/specs/canary-map-first-view-slots.md'

function getNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function createEmptyDebugStore(): FirstViewDebugStore {
  return {
    anchors: {},
    slots: {},
  }
}

function getSessionId(metricRef?: FirstViewMetricSink | null): string {
  const sessionId = metricRef?.current?.[SESSION_ID_KEY]
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : 'default'
}

function getDebugStore(metricRef?: FirstViewMetricSink | null): FirstViewDebugStore {
  const root = globalThis as typeof globalThis & {
    [GLOBAL_STORE_KEY]?: Record<string, FirstViewDebugStore>
  }
  if (!root[GLOBAL_STORE_KEY]) {
    root[GLOBAL_STORE_KEY] = {}
  }
  const sessionId = getSessionId(metricRef)
  if (!root[GLOBAL_STORE_KEY]![sessionId]) {
    root[GLOBAL_STORE_KEY]![sessionId] = createEmptyDebugStore()
  }
  return root[GLOBAL_STORE_KEY]![sessionId]!
}

function getOrCreateSlotRecord(
  store: FirstViewDebugStore,
  input: {
    slotKey: string
    slotType: FirstViewSlotType
    src: string
    owner: FirstViewSlotOwner
  },
): FirstViewSlotRecord {
  const existing = store.slots[input.slotKey]
  if (existing) return existing

  const created: FirstViewSlotRecord = {
    slotKey: input.slotKey,
    slotType: input.slotType,
    src: input.src,
    owner: input.owner,
    requestStartedAt: null,
    settledAt: null,
    settledState: null,
  }
  store.slots[input.slotKey] = created
  return created
}

function updateAggregateMetrics(metricRef: FirstViewMetricSink | null | undefined): void {
  const slots = Object.values(getDebugStore(metricRef).slots)
  const requested = slots.filter((slot) => slot.requestStartedAt != null)
  const settled = slots.filter((slot) => slot.settledAt != null)
  const visible = settled.filter((slot) => slot.settledState === 'visible')
  const fallback = settled.filter((slot) => slot.settledState === 'fallback')
  const firstRequestAt = requested.reduce<number | null>((earliest, slot) => {
    if (slot.requestStartedAt == null) return earliest
    return earliest == null ? slot.requestStartedAt : Math.min(earliest, slot.requestStartedAt)
  }, null)
  const firstSettledAt = settled.reduce<number | null>((earliest, slot) => {
    if (slot.settledAt == null) return earliest
    return earliest == null ? slot.settledAt : Math.min(earliest, slot.settledAt)
  }, null)

  if (!metricRef) return
  metricRef.current.first_view_tracked_request_count = requested.length
  metricRef.current.first_view_tracked_settled_count = settled.length
  metricRef.current.first_view_tracked_visible_count = visible.length
  metricRef.current.first_view_tracked_fallback_count = fallback.length
  if (firstRequestAt != null) {
    metricRef.current.first_view_first_request_start_ms = Math.round(firstRequestAt)
  }
  if (firstSettledAt != null) {
    metricRef.current.first_view_first_settled_ms = Math.round(firstSettledAt)
  }
}

function clearFirstViewMetrics(metricRef: FirstViewMetricSink | null | undefined): void {
  if (!metricRef) return
  for (const key of Object.keys(metricRef.current)) {
    if (key.startsWith('first_view_')) {
      delete metricRef.current[key]
    }
  }
}

export function getFirstViewTrackedSlotCount(viewportWidth?: number | null): number {
  const safeWidth = typeof viewportWidth === 'number' && Number.isFinite(viewportWidth)
    ? viewportWidth
    : typeof window !== 'undefined' && Number.isFinite(window.innerWidth)
      ? window.innerWidth
      : 1440
  return safeWidth <= FIRST_VIEW_MOBILE_MAX_WIDTH
    ? FIRST_VIEW_MOBILE_SLOT_COUNT
    : FIRST_VIEW_DESKTOP_SLOT_COUNT
}

export function prioritizeFirstViewItems<T>(
  items: readonly T[],
  viewportWidth?: number | null,
): {
  tracked: T[]
  overflow: T[]
  ordered: T[]
} {
  const trackedCount = getFirstViewTrackedSlotCount(viewportWidth)
  const tracked = items.slice(0, trackedCount)
  const overflow = items.slice(trackedCount)
  return {
    tracked,
    overflow,
    ordered: [...tracked, ...overflow],
  }
}

export function createFirstViewSlotKey(
  kind: 'cover' | 'thumb' | 'preview' | 'dom',
  id: string | number,
): string {
  return `${kind}-${String(id).trim()}`
}

export function beginFirstViewSession(
  metricRef: FirstViewMetricSink | null | undefined,
  sessionLabel = 'map-first-view',
  atMs = getNowMs(),
): number {
  clearFirstViewMetrics(metricRef)
  const sessionId = `${sessionLabel}:${Math.round(atMs)}:${++firstViewSessionCounter}`
  resetFirstViewDebugStore(metricRef)
  if (metricRef) {
    metricRef.current[SESSION_ID_KEY] = sessionId
  }
  getDebugStore(metricRef)
  if (metricRef) {
    metricRef.current.first_view_session_id = sessionId
    metricRef.current.first_view_session_label = sessionLabel
    metricRef.current.first_view_session_started_at_ms = Math.round(atMs)
  }
  return atMs
}

export function markFirstViewAnchor(
  metricRef: FirstViewMetricSink | null | undefined,
  anchor: FirstViewAnchor,
  atMs = getNowMs(),
): number {
  const store = getDebugStore(metricRef)
  if (store.anchors[anchor] != null) {
    return store.anchors[anchor]!
  }
  store.anchors[anchor] = atMs
  if (metricRef) {
    metricRef.current[`first_view_${anchor}_ms`] = Math.round(atMs)
  }
  return atMs
}

export function markFirstViewRequestStart(
  metricRef: FirstViewMetricSink | null | undefined,
  input: {
    slotKey: string
    slotType: FirstViewSlotType
    src: string
    owner: FirstViewSlotOwner
    atMs?: number
  },
): number {
  const store = getDebugStore(metricRef)
  const existing = getOrCreateSlotRecord(store, input)
  if (existing.requestStartedAt != null) {
    return existing.requestStartedAt
  }

  const atMs = input.atMs ?? getNowMs()
  existing.slotType = input.slotType
  existing.src = input.src
  existing.owner = input.owner
  existing.requestStartedAt = atMs
  store.slots[input.slotKey] = existing

  if (metricRef) {
    metricRef.current.first_view_last_slot_key = input.slotKey
    metricRef.current.first_view_last_slot_owner = input.owner
    metricRef.current.first_view_last_slot_src = input.src
  }
  updateAggregateMetrics(metricRef)
  return atMs
}

export function markFirstViewSettlement(
  metricRef: FirstViewMetricSink | null | undefined,
  input: {
    slotKey: string
    slotType: FirstViewSlotType
    src: string
    owner: FirstViewSlotOwner
    state: FirstViewSlotSettleState
    atMs?: number
  },
): number {
  const store = getDebugStore(metricRef)
  const existing = getOrCreateSlotRecord(store, input)
  if (existing.settledAt != null) {
    return existing.settledAt
  }

  const atMs = input.atMs ?? getNowMs()
  existing.slotType = input.slotType
  existing.src = input.src
  existing.owner = input.owner
  existing.settledAt = atMs
  existing.settledState = input.state
  store.slots[input.slotKey] = existing

  if (metricRef) {
    metricRef.current.first_view_last_slot_key = input.slotKey
    metricRef.current.first_view_last_slot_owner = input.owner
    metricRef.current.first_view_last_slot_src = input.src
    metricRef.current.first_view_last_settle_state = input.state
  }
  updateAggregateMetrics(metricRef)
  return atMs
}

export function readFirstViewDebugStore(metricRef?: FirstViewMetricSink | null): FirstViewDebugStore {
  return getDebugStore(metricRef)
}

export function resetFirstViewDebugStore(metricRef?: FirstViewMetricSink | null): void {
  const root = globalThis as typeof globalThis & {
    [GLOBAL_STORE_KEY]?: Record<string, FirstViewDebugStore>
  }
  const stores = root[GLOBAL_STORE_KEY]
  if (!stores) return

  if (!metricRef) {
    delete root[GLOBAL_STORE_KEY]
    return
  }

  const sessionId = getSessionId(metricRef)
  delete stores[sessionId]
  if (Object.keys(stores).length === 0) {
    delete root[GLOBAL_STORE_KEY]
  }
}
