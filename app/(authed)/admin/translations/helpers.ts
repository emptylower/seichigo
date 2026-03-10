import type { TranslationTaskListItem } from '@/lib/translation/adminDashboard'

export type UntranslatedItem = {
  entityType: string
  entityId: string
  title: string
  date: string
  missingLanguages: string[]
}

export type StatusKey = 'all' | 'pending' | 'processing' | 'ready' | 'approved' | 'failed'

export type TranslationsUIProps = {
  initialQuery?: {
    status: string
    entityType: string
    targetLanguage: string
    q: string
    page: number
    pageSize: number
  }
  initialTasks?: TranslationTaskListItem[]
  initialTotal?: number
  initialStats?: Record<string, number> | null
}

export type BatchExecutionProgress = {
  total: number
  processed: number
  success: number
  failed: number
  skipped: number
  running: boolean
  cancelled: boolean
  startedAt: number
  finishedAt: number | null
  currentTaskId: string | null
}

export type MapExecutionSummary = {
  total: number
  processed: number
  success: number
  failed: number
  skipped: number
  reclaimedProcessing: number
  errorMessages: string[]
}

export type MapExecuteStatusScope = 'pending' | 'failed' | 'pending_or_failed'

export type OneKeyMapQueueSnapshot = {
  bangumiRemaining: number | null
  pointRemaining: number | null
  bangumiQueueOpen: number | null
  pointQueueOpen: number | null
  bangumiPendingLike: number | null
  pointPendingLike: number | null
  bangumiReady: number | null
  pointReady: number | null
  estimatedUnfinishedTasks: number | null
}

export type OneKeyMapMetrics = {
  bangumiBatch: number
  bangumiBackfilledTotal: number
  bangumiRemaining: number | null
  readyTotal: number | null
  unfinishedTotal: number | null
  pointBackfilledEnqueued: number
  pointBackfilledUpdated: number
  pointBackfilledTotal: number
  pointQueueOpen: number | null
  pointUnqueuedEstimate: number | null
  pointUnfinishedTotal: number | null
  roundProcessed: number
  totalProcessed: number
  approvedTotal: number
  approvalFailedTotal: number
  stagnationCount: number
  estimatedTotal: number | null
  completionPercent: number
}

export type MapOpsProgress = {
  title: string
  detail: string
  running: boolean
  currentStep: number
  totalSteps: number
  processed: number
  success: number
  failed: number
  reclaimed: number
  skipped: number
  errors: string[]
  oneKey: OneKeyMapMetrics | null
}

export const MAP_EXECUTE_LIMIT_PENDING_PER_TYPE = 20
export const MAP_EXECUTE_LIMIT_FAILED_PER_TYPE = 10
export const MAP_EXECUTE_TIMEOUT_MS = 65_000
export const MAP_STATS_TIMEOUT_MS = 15_000
export const MAP_EXECUTE_RETRY_DELAY_MS = 1500
export const MAP_ONE_KEY_MAX_ROUNDS = 5000
export const MAP_ONE_KEY_BACKFILL_LIMIT = 20
export const MAP_ONE_KEY_BACKFILL_MAX_SWEEPS = 20
export const MAP_ONE_KEY_MAX_CONSECUTIVE_FAILURES = 3
export const MAP_ONE_KEY_RETRY_PER_ROUND = 2
export const MAP_ONE_KEY_MAX_CONSECUTIVE_FAILED_ONLY = 5
export const APPROVE_ALL_READY_PAGE_SIZE = 100
export const APPROVE_ALL_NON_MAP_CONCURRENCY = 4
export const APPROVE_ALL_READY_MAX_ROUNDS = 1000

export function clampInt(value: string | null, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = value ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

export function formatDateTime(value: string): string {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString('zh-CN')
}

export function isStatusKey(value: string): value is StatusKey {
  return (['all', 'pending', 'processing', 'ready', 'approved', 'failed'] as const).includes(value as StatusKey)
}

export function buildTaskSignature(input: {
  view: 'tasks' | 'untranslated'
  status: string
  entityType: string
  targetLanguage: string
  q: string
  page: number
  pageSize: number
}): string {
  return `${input.view}|${input.status}|${input.entityType}|${input.targetLanguage}|${input.q}|${input.page}|${input.pageSize}`
}

export function buildStatsSignature(entityType: string, targetLanguage: string): string {
  return `${entityType}|${targetLanguage}`
}

export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function calcProgressPercent(progress: MapOpsProgress | null): number {
  if (!progress) return 0
  if (progress.totalSteps <= 0) return progress.running ? 12 : 100
  const bounded = Math.max(0, Math.min(progress.currentStep, progress.totalSteps))
  if (progress.running && bounded === 0) return 12
  return Math.round((bounded / progress.totalSteps) * 100)
}

export function calcCompletionPercent(processed: number, estimatedTotal: number | null): number {
  if (estimatedTotal === null) return 0
  if (estimatedTotal <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((processed / estimatedTotal) * 100)))
}

export function calcOneKeyProgressPercent(progress: MapOpsProgress | null): number {
  if (!progress?.oneKey) return 0
  return Math.max(0, Math.min(100, progress.oneKey.completionPercent))
}

export function formatMetricCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-'
  return String(value)
}

export function collectErrorMessages(results: unknown): string[] {
  if (!Array.isArray(results)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of results) {
    const error = String((row as { error?: unknown } | null)?.error || '').trim()
    if (!error || seen.has(error)) continue
    seen.add(error)
    out.push(error)
    if (out.length >= 6) break
  }
  return out
}

export function appendUniqueMessages(target: string[], incoming: string[], max = 8): string[] {
  const next = [...target]
  const seen = new Set(next)
  for (const message of incoming) {
    const text = String(message || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    next.push(text)
    if (next.length >= max) break
  }
  return next
}

export function normalizeFetchErrorMessage(error: unknown, fallback: string): string {
  if (isAbortError(error)) {
    return '请求超时（超过 65 秒），请重试或减少单次执行规模'
  }

  const message = error instanceof Error ? String(error.message || '').trim() : ''
  if (!message) return fallback
  if (message === 'Failed to fetch') {
    return '请求失败（网络中断或函数超时），请稍后重试；若任务卡住可筛选“处理中”查看'
  }
  return message
}

export function isRetryableExecuteMessage(message: string): boolean {
  const text = String(message || '').toLowerCase()
  if (!text) return false
  return (
    text.includes('http 504') ||
    text.includes('超时') ||
    text.includes('timed out') ||
    text.includes('failed to fetch') ||
    text.includes('网络中断')
  )
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export type ExecuteApiResponse = {
  ok?: boolean
  error?: string
  total?: number
  processed?: number
  success?: number
  failed?: number
  skipped?: number
  reclaimedProcessing?: number
  results?: unknown
}

export type StatsApiResponse = {
  ok?: boolean
  error?: string
  counts?: Record<string, number>
}

export type MapSummaryApiResponse = {
  ok?: boolean
  error?: string
  bangumiRemaining?: number
  pointRemaining?: number
}

export type MapStatusSnapshot = {
  pending: number
  processing: number
  ready: number
  approved: number
  failed: number
}

export async function postExecuteTasks(payload: Record<string, unknown>, attempt = 0): Promise<ExecuteApiResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MAP_EXECUTE_TIMEOUT_MS)
  try {
    const res = await fetch('/api/admin/translations/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const raw = await res.text()
    let data: ExecuteApiResponse = {}

    if (raw) {
      try {
        data = JSON.parse(raw) as ExecuteApiResponse
      } catch {
        throw new Error(`执行接口返回了非 JSON 响应（HTTP ${res.status}），可能是函数超时`)
      }
    }

    if (!res.ok) {
      throw new Error(String(data.error || `执行失败（HTTP ${res.status}）`))
    }

    return data
  } catch (error) {
    const message = normalizeFetchErrorMessage(error, '执行请求失败')
    if (attempt < 1 && isRetryableExecuteMessage(message)) {
      await sleep(MAP_EXECUTE_RETRY_DELAY_MS)
      return postExecuteTasks(payload, attempt + 1)
    }
    throw new Error(message)
  } finally {
    clearTimeout(timer)
  }
}

export function sumStatusCounts(counts: Array<Record<string, number> | null | undefined>): MapStatusSnapshot {
  let pending = 0
  let processing = 0
  let ready = 0
  let approved = 0
  let failed = 0

  for (const row of counts) {
    if (!row) continue
    pending += Number(row.pending || 0)
    processing += Number(row.processing || 0)
    ready += Number(row.ready || 0)
    approved += Number(row.approved || 0)
    failed += Number(row.failed || 0)
  }

  return { pending, processing, ready, approved, failed }
}

export async function fetchTaskStatsByEntityType(input: {
  entityType: 'anitabi_bangumi' | 'anitabi_point'
  targetLanguage: string
}): Promise<Record<string, number>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MAP_STATS_TIMEOUT_MS)
  try {
    const params = new URLSearchParams()
    params.set('entityType', input.entityType)
    if (input.targetLanguage !== 'all') {
      params.set('targetLanguage', input.targetLanguage)
    }

    const res = await fetch(`/api/admin/translations/stats?${params.toString()}`, {
      method: 'GET',
      signal: controller.signal,
    })
    const raw = await res.text()
    let data: StatsApiResponse = {}
    if (raw) {
      try {
        data = JSON.parse(raw) as StatsApiResponse
      } catch {
        throw new Error(`状态接口返回非 JSON 响应（HTTP ${res.status}）`)
      }
    }
    if (!res.ok) {
      throw new Error(String(data.error || `状态接口失败（HTTP ${res.status}）`))
    }
    return (data.counts as Record<string, number>) || {}
  } finally {
    clearTimeout(timer)
  }
}

export async function loadMapStatusSnapshot(targetLanguage: string): Promise<MapStatusSnapshot> {
  const [bangumi, point] = await Promise.all([
    fetchTaskStatsByEntityType({ entityType: 'anitabi_bangumi', targetLanguage }),
    fetchTaskStatsByEntityType({ entityType: 'anitabi_point', targetLanguage }),
  ])
  return sumStatusCounts([bangumi, point])
}

export async function fetchMapRemainingSummary(input: {
  targetLanguage: string
}): Promise<{ bangumiRemaining: number; pointRemaining: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MAP_STATS_TIMEOUT_MS)
  try {
    const params = new URLSearchParams()
    if (input.targetLanguage !== 'all') {
      params.set('targetLanguage', input.targetLanguage)
    }

    const res = await fetch(`/api/admin/translations/map-summary?${params.toString()}`, {
      method: 'GET',
      signal: controller.signal,
    })
    const raw = await res.text()
    let data: MapSummaryApiResponse = {}
    if (raw) {
      try {
        data = JSON.parse(raw) as MapSummaryApiResponse
      } catch {
        throw new Error(`地图摘要返回非 JSON 响应（HTTP ${res.status}）`)
      }
    }
    if (!res.ok) {
      throw new Error(String(data.error || `地图摘要失败（HTTP ${res.status}）`))
    }
    return {
      bangumiRemaining: Number(data.bangumiRemaining || 0),
      pointRemaining: Number(data.pointRemaining || 0),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function sumUnfinishedTaskCount(counts: Record<string, number> | null | undefined): number {
  if (!counts) return 0
  return Number(counts.pending || 0) + Number(counts.processing || 0) + Number(counts.ready || 0) + Number(counts.failed || 0)
}

export function sumPendingLikeTaskCount(counts: Record<string, number> | null | undefined): number {
  if (!counts) return 0
  return Number(counts.pending || 0) + Number(counts.processing || 0) + Number(counts.failed || 0)
}

export async function loadOneKeyMapQueueSnapshot(targetLanguage: string): Promise<OneKeyMapQueueSnapshot> {
  const [bangumiStatsResult, pointStatsResult, mapSummaryResult] = await Promise.allSettled([
    fetchTaskStatsByEntityType({ entityType: 'anitabi_bangumi', targetLanguage }),
    fetchTaskStatsByEntityType({ entityType: 'anitabi_point', targetLanguage }),
    fetchMapRemainingSummary({ targetLanguage }),
  ])

  const bangumiStats = bangumiStatsResult.status === 'fulfilled' ? bangumiStatsResult.value : null
  const pointStats = pointStatsResult.status === 'fulfilled' ? pointStatsResult.value : null
  const mapSummary = mapSummaryResult.status === 'fulfilled' ? mapSummaryResult.value : null

  const bangumiQueueOpen = bangumiStats ? sumUnfinishedTaskCount(bangumiStats) : null
  const pointQueueOpen = pointStats ? sumUnfinishedTaskCount(pointStats) : null
  const bangumiPendingLike = bangumiStats ? sumPendingLikeTaskCount(bangumiStats) : null
  const pointPendingLike = pointStats ? sumPendingLikeTaskCount(pointStats) : null
  const bangumiReady = bangumiStats ? Number(bangumiStats.ready || 0) : null
  const pointReady = pointStats ? Number(pointStats.ready || 0) : null
  const bangumiRemaining = mapSummary ? Number(mapSummary.bangumiRemaining || 0) : null
  const pointRemaining = mapSummary ? Number(mapSummary.pointRemaining || 0) : null
  const estimatedUnfinishedTasks =
    bangumiQueueOpen === null || pointQueueOpen === null || bangumiRemaining === null || pointRemaining === null
      ? null
      : bangumiQueueOpen + pointQueueOpen + bangumiRemaining + pointRemaining

  return {
    bangumiRemaining,
    pointRemaining,
    bangumiQueueOpen,
    pointQueueOpen,
    bangumiPendingLike,
    pointPendingLike,
    bangumiReady,
    pointReady,
    estimatedUnfinishedTasks,
  }
}

export function buildPublicLinks(task: TranslationTaskListItem): { source?: string; target?: string } {
  const lang = String(task.targetLanguage || '').trim()
  const localePrefix = lang === 'en' ? '/en' : lang === 'ja' ? '/ja' : ''

  if (task.entityType === 'article' && task.subject.slug) {
    const slug = encodeURIComponent(task.subject.slug)
    const source = `/posts/${slug}`
    const target = `${localePrefix}/posts/${slug}`
    return { source, target }
  }

  if (task.entityType === 'city' && task.subject.slug) {
    const slug = encodeURIComponent(task.subject.slug)
    const source = `/city/${slug}`
    const target = `${localePrefix}/city/${slug}`
    return { source, target }
  }

  if (task.entityType === 'anime') {
    const id = encodeURIComponent(String(task.entityId || '').trim())
    if (!id) return {}
    const source = `/anime/${id}`
    const target = `${localePrefix}/anime/${id}`
    return { source, target }
  }

  if (task.entityType === 'anitabi_bangumi') {
    const id = encodeURIComponent(String(task.entityId || '').trim())
    if (!id) return {}
    const source = `/map?b=${id}`
    const target = `${localePrefix}/map?b=${id}`
    return { source, target }
  }

  if (task.entityType === 'anitabi_point') {
    const id = encodeURIComponent(String(task.entityId || '').trim())
    if (!id) return {}
    const source = `/map?p=${id}`
    const target = `${localePrefix}/map?p=${id}`
    return { source, target }
  }

  return {}
}
