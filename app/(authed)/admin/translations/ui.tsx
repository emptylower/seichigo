'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import Button from '@/components/shared/Button'
import { useAdminToast } from '@/hooks/useAdminToast'
import { useAdminConfirm } from '@/hooks/useAdminConfirm'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import type { TranslationTaskListItem } from '@/lib/translation/adminDashboard'

type UntranslatedItem = {
  entityType: string
  entityId: string
  title: string
  date: string
  missingLanguages: string[]
}

type StatusKey = 'all' | 'pending' | 'processing' | 'ready' | 'approved' | 'failed'

type TranslationsUIProps = {
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

type BatchExecutionProgress = {
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

type MapExecutionSummary = {
  total: number
  processed: number
  success: number
  failed: number
  skipped: number
  reclaimedProcessing: number
  errorMessages: string[]
}

type MapExecuteStatusScope = 'pending' | 'failed' | 'pending_or_failed'

type MapOpsProgress = {
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
}

const MAP_EXECUTE_LIMIT_PENDING_PER_TYPE = 20
const MAP_EXECUTE_LIMIT_FAILED_PER_TYPE = 10
const MAP_EXECUTE_TIMEOUT_MS = 65_000
const MAP_STATS_TIMEOUT_MS = 15_000
const MAP_EXECUTE_RETRY_DELAY_MS = 1500
const MAP_ONE_KEY_MAX_ROUNDS = 300
const MAP_ONE_KEY_MAX_CONSECUTIVE_FAILURES = 3
const MAP_ONE_KEY_RETRY_PER_ROUND = 2

function clampInt(value: string | null, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = value ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

function formatDateTime(value: string): string {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString('zh-CN')
}

function isStatusKey(value: string): value is StatusKey {
  return (['all', 'pending', 'processing', 'ready', 'approved', 'failed'] as const).includes(value as StatusKey)
}

function buildTaskSignature(input: {
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

function buildStatsSignature(entityType: string, targetLanguage: string): string {
  return `${entityType}|${targetLanguage}`
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function calcProgressPercent(progress: MapOpsProgress | null): number {
  if (!progress) return 0
  if (progress.totalSteps <= 0) return progress.running ? 12 : 100
  const bounded = Math.max(0, Math.min(progress.currentStep, progress.totalSteps))
  if (progress.running && bounded === 0) return 12
  return Math.round((bounded / progress.totalSteps) * 100)
}

function collectErrorMessages(results: unknown): string[] {
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

function appendUniqueMessages(target: string[], incoming: string[], max = 8): string[] {
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

function normalizeFetchErrorMessage(error: unknown, fallback: string): string {
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

function isRetryableExecuteMessage(message: string): boolean {
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type ExecuteApiResponse = {
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

type StatsApiResponse = {
  ok?: boolean
  error?: string
  counts?: Record<string, number>
}

type MapStatusSnapshot = {
  pending: number
  processing: number
  ready: number
  approved: number
  failed: number
}

async function postExecuteTasks(payload: Record<string, unknown>, attempt = 0): Promise<ExecuteApiResponse> {
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

function sumStatusCounts(counts: Array<Record<string, number> | null | undefined>): MapStatusSnapshot {
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

async function fetchTaskStatsByEntityType(input: {
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

async function loadMapStatusSnapshot(targetLanguage: string): Promise<MapStatusSnapshot> {
  const [bangumi, point] = await Promise.all([
    fetchTaskStatsByEntityType({ entityType: 'anitabi_bangumi', targetLanguage }),
    fetchTaskStatsByEntityType({ entityType: 'anitabi_point', targetLanguage }),
  ])
  return sumStatusCounts([bangumi, point])
}

function buildPublicLinks(task: TranslationTaskListItem): { source?: string; target?: string } {
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

export default function TranslationsUI({
  initialQuery,
  initialTasks = [],
  initialTotal = 0,
  initialStats = null,
}: TranslationsUIProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useAdminToast()
  const askForConfirm = useAdminConfirm()

  const [view, setView] = useState<'tasks' | 'untranslated'>('tasks')

  const [status, setStatus] = useState<StatusKey>(() => {
    if (initialQuery?.status && isStatusKey(initialQuery.status)) return initialQuery.status
    const raw = String(searchParams.get('status') || '').trim()
    return isStatusKey(raw) ? raw : 'ready'
  })
  const [entityType, setEntityType] = useState<string>(() => initialQuery?.entityType || searchParams.get('entityType') || 'all')
  const [targetLanguage, setTargetLanguage] = useState<string>(() => initialQuery?.targetLanguage || searchParams.get('targetLanguage') || 'all')
  const [q, setQ] = useState<string>(() => initialQuery?.q || searchParams.get('q') || '')
  const [page, setPage] = useState<number>(() =>
    typeof initialQuery?.page === 'number' ? initialQuery.page : clampInt(searchParams.get('page'), 1, { min: 1, max: 10_000 })
  )
  const [pageSize, setPageSize] = useState<number>(() =>
    typeof initialQuery?.pageSize === 'number'
      ? initialQuery.pageSize
      : clampInt(searchParams.get('pageSize'), 20, { min: 5, max: 100 })
  )

  const [debouncedQ, setDebouncedQ] = useState<string>(() => String(initialQuery?.q || searchParams.get('q') || '').trim())

  const [tasks, setTasks] = useState<TranslationTaskListItem[]>(() => initialTasks)
  const [total, setTotal] = useState(() => initialTotal)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)

  const [stats, setStats] = useState<Record<string, number> | null>(() => initialStats)
  const [statsLoading, setStatsLoading] = useState(false)

  const [untranslatedItems, setUntranslatedItems] = useState<UntranslatedItem[]>([])
  const [untranslatedLoading, setUntranslatedLoading] = useState(false)
  const [untranslatedQuery, setUntranslatedQuery] = useState('')
  const [untranslatedPage, setUntranslatedPage] = useState(1)
  const [untranslatedPageSize] = useState(30)
  const [untranslatedTotal, setUntranslatedTotal] = useState(0)

  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchTaskItems, setBatchTaskItems] = useState<TranslationTaskListItem[]>([])
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchExecuting, setBatchExecuting] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<BatchExecutionProgress | null>(null)
  const [mapOpsLoading, setMapOpsLoading] = useState(false)
  const [mapOpsMessage, setMapOpsMessage] = useState<string | null>(null)
  const [mapOpsProgress, setMapOpsProgress] = useState<MapOpsProgress | null>(null)
  const [bangumiBackfillCursor, setBangumiBackfillCursor] = useState<string | null>(null)
  const [pointBackfillCursor, setPointBackfillCursor] = useState<string | null>(null)
  const [sampleApproving, setSampleApproving] = useState(false)

  const statusLabels: Record<string, string> = {
    all: '全部',
    pending: '待处理',
    processing: '处理中',
    ready: '待审核',
    approved: '已上架',
    failed: '失败',
  }

  const entityTypeLabels: Record<string, string> = {
    all: '全部',
    article: '文章',
    city: '城市',
    anime: '动漫',
    anitabi_bangumi: '地图作品',
    anitabi_point: '地图地标',
  }

  const languageLabels: Record<string, string> = {
    all: '全部',
    en: 'English',
    ja: '日本語',
  }

  const articleStatusLabels: Record<string, string> = {
    draft: '草稿',
    in_review: '审核中',
    published: '已发布',
    rejected: '已驳回',
  }

  const statusTabs: Array<{ key: StatusKey; label: string }> = [
    { key: 'ready', label: '待审核' },
    { key: 'pending', label: '待处理' },
    { key: 'processing', label: '处理中' },
    { key: 'approved', label: '已上架' },
    { key: 'failed', label: '失败' },
    { key: 'all', label: '全部' },
  ]

  const taskAbort = useRef<AbortController | null>(null)
  const statsAbort = useRef<AbortController | null>(null)
  const batchCancelRef = useRef(false)
  const initialTaskSignatureRef = useRef<string | null>(
    initialQuery
      ? buildTaskSignature({
          view: 'tasks',
          status: initialQuery.status,
          entityType: initialQuery.entityType,
          targetLanguage: initialQuery.targetLanguage,
          q: String(initialQuery.q || '').trim(),
          page: initialQuery.page,
          pageSize: initialQuery.pageSize,
        })
      : null
  )
  const initialStatsSignatureRef = useRef<string | null>(
    initialQuery && initialStats
      ? buildStatsSignature(initialQuery.entityType, initialQuery.targetLanguage)
      : null
  )

  function beginMapOpsProgress(input: { title: string; totalSteps: number; detail: string }) {
    setMapOpsProgress({
      title: input.title,
      detail: input.detail,
      running: true,
      currentStep: 0,
      totalSteps: Math.max(1, input.totalSteps),
      processed: 0,
      success: 0,
      failed: 0,
      reclaimed: 0,
      skipped: 0,
      errors: [],
    })
  }

  function patchMapOpsProgress(patch: Partial<MapOpsProgress>) {
    setMapOpsProgress((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => window.clearTimeout(t)
  }, [q])

  useEffect(() => {
    // Keep URL in sync (so refresh/back preserves filters).
    const next = new URLSearchParams()
    if (status !== 'ready') next.set('status', status)
    if (entityType !== 'all') next.set('entityType', entityType)
    if (targetLanguage !== 'all') next.set('targetLanguage', targetLanguage)
    if (q.trim()) next.set('q', q.trim())
    if (page > 1) next.set('page', String(page))
    if (pageSize !== 20) next.set('pageSize', String(pageSize))

    const current = searchParams.toString()
    const desired = next.toString()
    if (current === desired) return
    router.replace(desired ? `/admin/translations?${desired}` : '/admin/translations', { scroll: false })
  }, [entityType, page, pageSize, q, router, searchParams, status, targetLanguage])

  async function loadBatchTaskItems() {
    setBatchLoading(true)
    setBatchError(null)
    try {
      const pageSize = 100
      let nextPage = 1
      let total = 0
      const all: TranslationTaskListItem[] = []

      while (nextPage <= 100) {
        const params = new URLSearchParams()
        params.set('status', 'pending')
        params.set('page', String(nextPage))
        params.set('pageSize', String(pageSize))

        const res = await fetch(`/api/admin/translations?${params.toString()}`, { method: 'GET' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || '加载待翻译任务失败')

        const rows = Array.isArray(data.tasks) ? (data.tasks as TranslationTaskListItem[]) : []
        all.push(...rows)
        total = typeof data.total === 'number' ? data.total : Number.parseInt(String(data.total || 0), 10) || 0

        if (all.length >= total || rows.length === 0) break
        nextPage += 1
      }

      setBatchTaskItems(all)
      setBatchSelectedIds(all.map((t) => t.id))
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载待翻译任务失败'
      setBatchTaskItems([])
      setBatchSelectedIds([])
      setBatchError(msg)
    } finally {
      setBatchLoading(false)
    }
  }

  async function handleBatchSubmit() {
    if (batchSelectedIds.length === 0) return

    const selectedIds = [...batchSelectedIds]
    const aggregate = {
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    }

    batchCancelRef.current = false
    setBatchExecuting(true)
    setBatchError(null)
    setShowBatchModal(false)
    setBatchProgress({
      total: selectedIds.length,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      running: true,
      cancelled: false,
      startedAt: Date.now(),
      finishedAt: null,
      currentTaskId: null,
    })

    let lastError = ''
    try {
      for (const taskId of selectedIds) {
        if (batchCancelRef.current) break

        setBatchProgress((prev) => (prev ? { ...prev, currentTaskId: taskId } : prev))

        try {
          const res = await fetch('/api/admin/translations/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskIds: [taskId] }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error || '批量执行失败')

          aggregate.success += Number(data.success || 0)
          aggregate.failed += Number(data.failed || 0)
          aggregate.skipped += Number(data.skipped || 0)
        } catch (error: any) {
          aggregate.failed += 1
          lastError = String(error?.message || '批量执行失败')
        } finally {
          aggregate.processed += 1
          setBatchProgress((prev) =>
            prev
              ? {
                  ...prev,
                  processed: aggregate.processed,
                  success: aggregate.success,
                  failed: aggregate.failed,
                  skipped: aggregate.skipped,
                }
              : prev
          )
        }
      }

      const cancelled = batchCancelRef.current
      setBatchProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              cancelled,
              finishedAt: Date.now(),
              currentTaskId: null,
            }
          : prev
      )

      if (lastError) {
        setBatchError(lastError)
      }

      if (cancelled) {
        toast.info(
          `已中断，已处理 ${aggregate.processed} / ${selectedIds.length} 个（成功 ${aggregate.success}，失败 ${aggregate.failed}，跳过 ${aggregate.skipped}）`,
          '批量翻译已中断'
        )
      } else {
        toast.success(`已执行 ${aggregate.processed} 个，成功 ${aggregate.success} 个，失败 ${aggregate.failed} 个，跳过 ${aggregate.skipped} 个`)
      }

      setBatchSelectedIds([])
      await Promise.all([loadTasks(), loadUntranslated(), loadStats()])
    } catch (error: any) {
      const msg = error?.message || '操作失败'
      setBatchError(msg)
      setBatchProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              cancelled: false,
              finishedAt: Date.now(),
              currentTaskId: null,
            }
          : prev
      )
      toast.error(msg)
    } finally {
      setBatchExecuting(false)
    }
  }

  function cancelBatchExecution() {
    batchCancelRef.current = true
  }

  function toggleBatchSelectAll() {
    if (batchSelectedIds.length === batchTaskItems.length) {
      setBatchSelectedIds([])
      return
    }
    setBatchSelectedIds(batchTaskItems.map((t) => t.id))
  }

  function toggleBatchItem(id: string) {
    setBatchSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [...prev, id]
    })
  }

  useEffect(() => {
    if (!showBatchModal) return
    void loadBatchTaskItems()
  }, [showBatchModal])

  async function loadTasks() {
    if (view !== 'tasks') return

    const currentTaskSignature = buildTaskSignature({
      view,
      status,
      entityType,
      targetLanguage,
      q: debouncedQ,
      page,
      pageSize,
    })
    if (initialTaskSignatureRef.current && currentTaskSignature === initialTaskSignatureRef.current) {
      initialTaskSignatureRef.current = null
      setTasksError(null)
      return
    }

    taskAbort.current?.abort()
    const controller = new AbortController()
    taskAbort.current = controller

    setTasksLoading(true)
    setTasksError(null)
    try {
      const params = new URLSearchParams()
      params.set('status', status)
      params.set('entityType', entityType)
      params.set('targetLanguage', targetLanguage)
      if (debouncedQ) params.set('q', debouncedQ)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))

      const res = await fetch(`/api/admin/translations?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '加载失败')
      setTasks((data.tasks || []) as TranslationTaskListItem[])
      setTotal(typeof data.total === 'number' ? data.total : Number.parseInt(String(data.total || 0), 10) || 0)
    } catch (error) {
      if (isAbortError(error)) return
      const msg = error instanceof Error ? error.message : '加载失败'
      setTasksError(msg)
    } finally {
      if (taskAbort.current === controller) taskAbort.current = null
      setTasksLoading(false)
    }
  }

  async function loadStats() {
    const currentStatsSignature = buildStatsSignature(entityType, targetLanguage)
    if (initialStatsSignatureRef.current && currentStatsSignature === initialStatsSignatureRef.current) {
      initialStatsSignatureRef.current = null
      return
    }

    statsAbort.current?.abort()
    const controller = new AbortController()
    statsAbort.current = controller

    setStatsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('entityType', entityType)
      params.set('targetLanguage', targetLanguage)
      const res = await fetch(`/api/admin/translations/stats?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '加载失败')
      if (data && data.ok && typeof data.counts === 'object') {
        setStats(data.counts as Record<string, number>)
      } else {
        setStats(null)
      }
    } catch (error) {
      if (isAbortError(error)) return
      setStats(null)
    } finally {
      if (statsAbort.current === controller) statsAbort.current = null
      setStatsLoading(false)
    }
  }

  async function loadUntranslated() {
    setUntranslatedLoading(true)
    try {
      const params = new URLSearchParams()
      if (untranslatedQuery.trim()) params.set('q', untranslatedQuery.trim())
      params.set('entityType', entityType)
      params.set('page', String(untranslatedPage))
      params.set('pageSize', String(untranslatedPageSize))

      const res = await fetch(`/api/admin/translations/untranslated?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '加载未翻译内容失败')
      setUntranslatedItems(Array.isArray(data.items) ? data.items : [])
      setUntranslatedTotal(typeof data.total === 'number' ? data.total : Number.parseInt(String(data.total || 0), 10) || 0)
    } catch (error) {
      console.error('Failed to load untranslated items', error)
      setUntranslatedItems([])
      setUntranslatedTotal(0)
    } finally {
      setUntranslatedLoading(false)
    }
  }

  async function runMapBackfillOnce(input: {
    entityType: 'anitabi_bangumi' | 'anitabi_point'
    mode: 'missing' | 'stale' | 'all'
    limit?: number
    cursor?: string | null
  }): Promise<{ scanned: number; enqueued: number; updated: number; nextCursor: string | null; done: boolean }> {
    const res = await fetch('/api/admin/translations/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: input.entityType,
        targetLanguages: ['en', 'ja'],
        mode: input.mode,
        limit: input.limit ?? 1000,
        cursor: input.cursor || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '回填任务创建失败')
    return {
      scanned: Number(data.scanned || 0),
      enqueued: Number(data.enqueued || 0),
      updated: Number(data.updated || 0),
      nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
      done: Boolean(data.done),
    }
  }

  async function handleMapBackfill(entityType: 'anitabi_bangumi' | 'anitabi_point') {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    const actionLabel = entityTypeLabels[entityType]
    beginMapOpsProgress({
      title: `${actionLabel}回填`,
      totalSteps: 1,
      detail: `正在扫描并创建 ${actionLabel} 翻译任务...`,
    })
    try {
      const cursor = entityType === 'anitabi_bangumi' ? bangumiBackfillCursor : pointBackfillCursor
      const result = await runMapBackfillOnce({
        entityType,
        mode: 'all',
        limit: 1000,
        cursor,
      })

      if (entityType === 'anitabi_bangumi') {
        setBangumiBackfillCursor(result.done ? null : result.nextCursor)
      } else {
        setPointBackfillCursor(result.done ? null : result.nextCursor)
      }

      setMapOpsMessage(
        `${entityTypeLabels[entityType]}：扫描 ${result.scanned}，新建 ${result.enqueued}，更新 ${result.updated}${result.done ? '（当前回填已完成）' : `（可继续，cursor=${result.nextCursor || '-'})`}`
      )
      patchMapOpsProgress({
        running: false,
        currentStep: 1,
        processed: result.scanned,
        success: result.enqueued,
        skipped: result.updated,
        errors: [],
        detail: `回填完成：扫描 ${result.scanned}，新建 ${result.enqueued}，更新 ${result.updated}${result.done ? '（当前回填已完成）' : ''}`,
      })
      toast.success(`${entityTypeLabels[entityType]}回填已执行`)
      await Promise.all([loadTasks(), loadStats(), loadUntranslated()])
    } catch (error) {
      const msg = error instanceof Error ? error.message : '回填任务创建失败'
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        failed: 1,
        errors: [msg],
        detail: msg,
      })
      toast.error(msg)
    } finally {
      setMapOpsLoading(false)
    }
  }

  async function handleMapIncrementalRefill() {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    beginMapOpsProgress({
      title: '地图增量补队',
      totalSteps: 2,
      detail: '正在补队地图作品...',
    })
    try {
      const bangumiResult = await runMapBackfillOnce({ entityType: 'anitabi_bangumi', mode: 'stale', limit: 1000 })
      patchMapOpsProgress({
        currentStep: 1,
        processed: bangumiResult.scanned,
        success: bangumiResult.enqueued,
        skipped: bangumiResult.updated,
        errors: [],
        detail: `作品补队完成：新建 ${bangumiResult.enqueued}，更新 ${bangumiResult.updated}。正在补队点位...`,
      })
      const pointResult = await runMapBackfillOnce({ entityType: 'anitabi_point', mode: 'stale', limit: 1000 })

      setMapOpsMessage(
        `增量补队完成：作品 新建 ${bangumiResult.enqueued}/更新 ${bangumiResult.updated}，点位 新建 ${pointResult.enqueued}/更新 ${pointResult.updated}`
      )
      patchMapOpsProgress({
        running: false,
        currentStep: 2,
        processed: bangumiResult.scanned + pointResult.scanned,
        success: bangumiResult.enqueued + pointResult.enqueued,
        skipped: bangumiResult.updated + pointResult.updated,
        errors: [],
        detail: `增量补队完成：作品 新建 ${bangumiResult.enqueued}/更新 ${bangumiResult.updated}，点位 新建 ${pointResult.enqueued}/更新 ${pointResult.updated}`,
      })
      toast.success('地图增量补队已执行')
      await Promise.all([loadTasks(), loadStats(), loadUntranslated()])
    } catch (error) {
      const msg = error instanceof Error ? error.message : '增量补队失败'
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        failed: 1,
        errors: [msg],
        detail: msg,
      })
      toast.error(msg)
    } finally {
      setMapOpsLoading(false)
    }
  }

  async function executeMapTranslateRound(input?: { statusScope?: MapExecuteStatusScope }): Promise<MapExecutionSummary> {
    const statusScope: MapExecuteStatusScope = input?.statusScope || 'pending'
    const limitPerType =
      statusScope === 'failed' ? MAP_EXECUTE_LIMIT_FAILED_PER_TYPE : MAP_EXECUTE_LIMIT_PENDING_PER_TYPE
    const concurrency = statusScope === 'failed' ? 1 : 2
    const summary: MapExecutionSummary = {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      reclaimedProcessing: 0,
      errorMessages: [],
    }
    const requestErrors: string[] = []
    let beforeSnapshot: MapStatusSnapshot | null = null

    try {
      beforeSnapshot = await loadMapStatusSnapshot(targetLanguage)
    } catch {
      beforeSnapshot = null
    }

    for (const entityType of ['anitabi_bangumi', 'anitabi_point'] as const) {
      try {
        const data = await postExecuteTasks({
          entityType,
          targetLanguage: targetLanguage === 'all' ? undefined : targetLanguage,
          limit: limitPerType,
          includeFailed: statusScope !== 'pending',
          statusScope,
          concurrency,
        })

        summary.total += Number(data.total || 0)
        summary.processed += Number(data.processed || 0)
        summary.success += Number(data.success || 0)
        summary.failed += Number(data.failed || 0)
        summary.skipped += Number(data.skipped || 0)
        summary.reclaimedProcessing += Number(data.reclaimedProcessing || 0)
        summary.errorMessages.push(...collectErrorMessages(data.results))
      } catch (error) {
        requestErrors.push(normalizeFetchErrorMessage(error, `${entityType} 执行失败`))
      }
    }

    if (summary.reclaimedProcessing > 0) {
      summary.errorMessages.unshift(`已回收 ${summary.reclaimedProcessing} 条长时间 processing 的任务（标记为 failed）`)
    }

    if (requestErrors.length > 0) {
      summary.errorMessages.push(...requestErrors)

      try {
        const afterSnapshot = await loadMapStatusSnapshot(targetLanguage)
        if (beforeSnapshot) {
          const successDelta = Math.max(0, afterSnapshot.ready - beforeSnapshot.ready)
          const failedDelta = Math.max(0, afterSnapshot.failed - beforeSnapshot.failed)
          const processedDelta = successDelta + failedDelta

          if (processedDelta > summary.processed) {
            summary.processed = processedDelta
            summary.success = Math.max(summary.success, successDelta)
            summary.failed = Math.max(summary.failed, failedDelta)
            summary.total = Math.max(summary.total, processedDelta)
            const estimatedFailedWithoutReclaimed = Math.max(0, failedDelta - summary.reclaimedProcessing)
            summary.errorMessages.push(
              `本轮请求超时，但后台已推进：估算成功 ${successDelta}，翻译失败 ${estimatedFailedWithoutReclaimed}，回收 ${summary.reclaimedProcessing}（按状态差值）`
            )
          }
        }
      } catch {
        // ignore snapshot fallback error
      }
    }

    summary.errorMessages = Array.from(new Set(summary.errorMessages)).slice(0, 6)

    if (summary.processed === 0 && requestErrors.length > 0) {
      summary.errorMessages.unshift('本轮未拿到有效执行结果，可能是网关超时；任务状态可能未变化')
    }

    return summary
  }

  async function executeMapSingleRound(input: {
    statusScope: MapExecuteStatusScope
    title: string
    loadingDetail: string
    successPrefix: string
    failFallback: string
  }) {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    beginMapOpsProgress({
      title: input.title,
      totalSteps: 1,
      detail: input.loadingDetail,
    })
    try {
      const round = await executeMapTranslateRound({ statusScope: input.statusScope })
      const translationFailed = Math.max(0, round.failed - round.reclaimedProcessing)
      const errorText = round.errorMessages.length > 0 ? `；原因：${round.errorMessages.join(' ｜ ')}` : ''

      setMapOpsMessage(
        `${input.successPrefix}：处理 ${round.processed}，成功 ${round.success}，翻译失败 ${translationFailed}，回收 ${round.reclaimedProcessing}，跳过 ${round.skipped}${errorText}`
      )
      patchMapOpsProgress({
        running: false,
        currentStep: 1,
        processed: round.processed,
        success: round.success,
        failed: translationFailed,
        reclaimed: round.reclaimedProcessing,
        skipped: round.skipped,
        errors: round.errorMessages,
        detail: `${input.successPrefix}：处理 ${round.processed}，成功 ${round.success}，翻译失败 ${translationFailed}，回收 ${round.reclaimedProcessing}，跳过 ${round.skipped}${errorText}`,
      })
      if (round.processed > 0) {
        toast.success(`${input.successPrefix}：处理 ${round.processed}`)
      } else if (round.errorMessages.length > 0) {
        toast.info('本轮未推进，可能是网关超时，请稍后重试')
      } else {
        toast.info('本轮没有可处理的任务')
      }
      await Promise.all([loadTasks(), loadStats(), loadUntranslated()])
    } catch (error) {
      const msg = normalizeFetchErrorMessage(error, input.failFallback)
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        failed: 1,
        errors: [msg],
        detail: msg,
      })
      toast.error(msg)
    } finally {
      setMapOpsLoading(false)
    }
  }

  async function executeMapPendingBatch() {
    await executeMapSingleRound({
      statusScope: 'pending',
      title: '执行地图待翻译（单轮）',
      loadingDetail: '正在执行 pending 地图翻译任务（作品 + 点位）...',
      successPrefix: '单轮执行完成',
      failFallback: '地图批量执行失败',
    })
  }

  async function executeMapFailedBatch() {
    await executeMapSingleRound({
      statusScope: 'failed',
      title: '重试地图失败任务（单轮）',
      loadingDetail: '正在重试 failed 地图任务（作品 + 点位）...',
      successPrefix: '失败任务重试完成',
      failFallback: '地图失败任务重试失败',
    })
  }

  async function handleOneKeyAdvanceMapQueue() {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    try {
      let initialPending = 0
      try {
        const snapshot = await loadMapStatusSnapshot(targetLanguage)
        initialPending = Number(snapshot.pending || 0)
      } catch {
        initialPending = 0
      }

      const estimatedRounds = Math.max(
        1,
        Math.ceil(initialPending / Math.max(1, MAP_EXECUTE_LIMIT_PENDING_PER_TYPE * 2))
      )

      beginMapOpsProgress({
        title: '一键推进地图队列',
        totalSteps: estimatedRounds,
        detail: `准备开始批次推进（预计 ${estimatedRounds} 轮）...`,
      })

      let attemptedRounds = 0
      let progressedRounds = 0
      let totalProcessed = 0
      let totalSuccess = 0
      let totalFailed = 0
      let totalReclaimed = 0
      let totalSkipped = 0
      let consecutiveNoProgress = 0
      let queueDrained = false
      let reachedRoundCap = false
      let allErrors: string[] = []

      for (let i = 0; i < MAP_ONE_KEY_MAX_ROUNDS; i += 1) {
        attemptedRounds = i + 1
        const dynamicTotalSteps = Math.max(estimatedRounds, attemptedRounds)
        patchMapOpsProgress({
          totalSteps: dynamicTotalSteps,
          currentStep: i,
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          errors: allErrors,
          detail: `正在执行第 ${attemptedRounds} 轮（自动推进）...`,
        })

        let round: MapExecutionSummary | null = null
        for (let retry = 0; retry <= MAP_ONE_KEY_RETRY_PER_ROUND; retry += 1) {
          round = await executeMapTranslateRound({ statusScope: 'pending' })

          const hasRetryableError = round.errorMessages.some(
            (message) => isRetryableExecuteMessage(message) || message.includes('未拿到有效执行结果')
          )
          const shouldRetry = round.processed === 0 && round.total > 0 && hasRetryableError && retry < MAP_ONE_KEY_RETRY_PER_ROUND

          if (!shouldRetry) break

          allErrors = appendUniqueMessages(allErrors, round.errorMessages)
          patchMapOpsProgress({
            totalSteps: dynamicTotalSteps,
            currentStep: i,
            errors: allErrors,
            detail: `第 ${attemptedRounds} 轮未推进，自动重试 ${retry + 1}/${MAP_ONE_KEY_RETRY_PER_ROUND}...`,
          })
          await sleep(MAP_EXECUTE_RETRY_DELAY_MS)
        }

        if (!round) continue

        const translationFailed = Math.max(0, round.failed - round.reclaimedProcessing)
        allErrors = appendUniqueMessages(allErrors, round.errorMessages)

        if (round.total === 0) {
          queueDrained = true
          patchMapOpsProgress({
            currentStep: attemptedRounds,
            totalSteps: Math.max(estimatedRounds, attemptedRounds),
            detail: `第 ${attemptedRounds} 轮完成：队列已清空`,
          })
          break
        }

        if (round.processed === 0) {
          consecutiveNoProgress += 1
          patchMapOpsProgress({
            currentStep: attemptedRounds,
            totalSteps: Math.max(estimatedRounds, attemptedRounds),
            errors: allErrors,
            detail: `第 ${attemptedRounds} 轮无进展（连续 ${consecutiveNoProgress} 轮），准备下一轮...`,
          })

          if (consecutiveNoProgress >= MAP_ONE_KEY_MAX_CONSECUTIVE_FAILURES) {
            break
          }
          continue
        }

        consecutiveNoProgress = 0
        progressedRounds += 1
        totalProcessed += round.processed
        totalSuccess += round.success
        totalFailed += translationFailed
        totalReclaimed += round.reclaimedProcessing
        totalSkipped += round.skipped

        patchMapOpsProgress({
          currentStep: attemptedRounds,
          totalSteps: Math.max(estimatedRounds, attemptedRounds),
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          errors: allErrors,
          detail: `第 ${attemptedRounds} 轮完成：处理 ${round.processed}（成功 ${round.success}，翻译失败 ${translationFailed}，回收 ${round.reclaimedProcessing}）`,
        })
      }

      if (!queueDrained && attemptedRounds >= MAP_ONE_KEY_MAX_ROUNDS) {
        reachedRoundCap = true
      }

      const failureStop = consecutiveNoProgress >= MAP_ONE_KEY_MAX_CONSECUTIVE_FAILURES
      const reasonText = allErrors.length > 0 ? `；原因：${allErrors.join(' ｜ ')}` : ''

      if (queueDrained) {
        const msg = `一键推进完成：共尝试 ${attemptedRounds} 轮，实际推进 ${progressedRounds} 轮，处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}（队列已清空）${reasonText}`
        setMapOpsMessage(msg)
        patchMapOpsProgress({
          running: false,
          currentStep: attemptedRounds,
          totalSteps: Math.max(estimatedRounds, attemptedRounds),
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          errors: allErrors,
          detail: msg,
        })
        toast.success(`一键推进完成：处理 ${totalProcessed} 条`)
      } else if (failureStop) {
        const msg = `一键推进已暂停：连续 ${consecutiveNoProgress} 轮无进展，避免无限重试。已处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}${reasonText}`
        setMapOpsMessage(msg)
        patchMapOpsProgress({
          running: false,
          currentStep: attemptedRounds,
          totalSteps: Math.max(estimatedRounds, attemptedRounds),
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          errors: allErrors,
          detail: msg,
        })
        toast.error('一键推进已暂停：连续失败过多')
      } else if (reachedRoundCap) {
        const msg = `一键推进达到安全上限 ${MAP_ONE_KEY_MAX_ROUNDS} 轮，已自动暂停。当前处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}${reasonText}`
        setMapOpsMessage(msg)
        patchMapOpsProgress({
          running: false,
          currentStep: attemptedRounds,
          totalSteps: Math.max(estimatedRounds, attemptedRounds),
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          errors: allErrors,
          detail: msg,
        })
        toast.info('一键推进达到安全上限，已暂停')
      } else {
        const msg = `一键推进结束：处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}${reasonText}`
        setMapOpsMessage(msg)
        patchMapOpsProgress({
          running: false,
          currentStep: attemptedRounds,
          totalSteps: Math.max(estimatedRounds, attemptedRounds),
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          errors: allErrors,
          detail: msg,
        })
        toast.info('一键推进已结束')
      }

      await Promise.all([loadTasks(), loadStats(), loadUntranslated()])
    } catch (error) {
      const msg = normalizeFetchErrorMessage(error, '一键推进失败')
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        failed: 1,
        errors: [msg],
        detail: msg,
      })
      toast.error(msg)
    } finally {
      setMapOpsLoading(false)
    }
  }

  async function handleManualAdvanceMapQueue(maxRounds = 10) {
    setMapOpsLoading(true)
    setMapOpsMessage(null)
    try {
      const rounds = Math.max(1, Math.min(20, Math.floor(maxRounds)))
      beginMapOpsProgress({
        title: `手动推进地图队列（最多 ${rounds} 轮）`,
        totalSteps: rounds,
        detail: `准备执行第 1 / ${rounds} 轮...`,
      })
      let roundCount = 0
      let totalProcessed = 0
      let totalSuccess = 0
      let totalFailed = 0
      let totalReclaimed = 0
      let totalSkipped = 0
      let queueDrained = false
      const allErrors: string[] = []

      for (let i = 0; i < rounds; i += 1) {
        patchMapOpsProgress({
          currentStep: i,
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          detail: `正在执行第 ${i + 1} / ${rounds} 轮...`,
        })
        const round = await executeMapTranslateRound({ statusScope: 'pending' })
        if (round.total === 0 || round.processed === 0) {
          queueDrained = true
          break
        }

        roundCount += 1
        totalProcessed += round.processed
        totalSuccess += round.success
        totalFailed += Math.max(0, round.failed - round.reclaimedProcessing)
        totalReclaimed += round.reclaimedProcessing
        totalSkipped += round.skipped
        if (round.errorMessages.length > 0) {
          for (const message of round.errorMessages) {
            if (!allErrors.includes(message)) {
              allErrors.push(message)
              if (allErrors.length >= 6) break
            }
          }
        }

        patchMapOpsProgress({
          currentStep: i + 1,
          processed: totalProcessed,
          success: totalSuccess,
          failed: totalFailed,
          reclaimed: totalReclaimed,
          skipped: totalSkipped,
          errors: allErrors,
          detail: `第 ${i + 1} 轮完成：本轮处理 ${round.processed}（成功 ${round.success}，翻译失败 ${Math.max(0, round.failed - round.reclaimedProcessing)}，回收 ${round.reclaimedProcessing}）`,
        })
      }

      if (roundCount === 0) {
        setMapOpsMessage('当前没有 pending 的地图翻译任务，队列已是最新状态')
        patchMapOpsProgress({
          running: false,
          currentStep: 1,
          totalSteps: 1,
          errors: [],
          detail: '当前没有 pending 的地图翻译任务，队列已是最新状态',
        })
        toast.info('当前没有 pending 的地图翻译任务')
        return
      }

      const suffix = queueDrained ? '（队列已清空）' : `（达到手动推进上限 ${rounds} 轮）`
      const errorText = allErrors.length > 0 ? `；原因：${allErrors.join(' ｜ ')}` : ''
      setMapOpsMessage(
        `手动推进完成：共 ${roundCount} 轮，处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}${suffix}${errorText}`
      )
      patchMapOpsProgress({
        running: false,
        currentStep: queueDrained ? roundCount : rounds,
        totalSteps: queueDrained ? roundCount : rounds,
        processed: totalProcessed,
        success: totalSuccess,
        failed: totalFailed,
        reclaimed: totalReclaimed,
        skipped: totalSkipped,
        errors: allErrors,
        detail: `手动推进完成：共 ${roundCount} 轮，处理 ${totalProcessed}，成功 ${totalSuccess}，翻译失败 ${totalFailed}，回收 ${totalReclaimed}，跳过 ${totalSkipped}${suffix}${errorText}`,
      })
      toast.success(`手动推进完成：处理 ${totalProcessed} 条`)
      await Promise.all([loadTasks(), loadStats(), loadUntranslated()])
    } catch (error) {
      const msg = normalizeFetchErrorMessage(error, '手动推进失败')
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        failed: 1,
        errors: [msg],
        detail: msg,
      })
      toast.error(msg)
    } finally {
      setMapOpsLoading(false)
    }
  }

  async function loadReadyMapTasks(limitPerType: number): Promise<TranslationTaskListItem[]> {
    const [bangumiRes, pointRes] = await Promise.all([
      fetch(`/api/admin/translations?status=ready&entityType=anitabi_bangumi&page=1&pageSize=${limitPerType}`),
      fetch(`/api/admin/translations?status=ready&entityType=anitabi_point&page=1&pageSize=${limitPerType}`),
    ])

    const [bangumiData, pointData] = await Promise.all([
      bangumiRes.json().catch(() => ({})),
      pointRes.json().catch(() => ({})),
    ])

    if (!bangumiRes.ok) throw new Error(bangumiData.error || '获取地图作品待审核任务失败')
    if (!pointRes.ok) throw new Error(pointData.error || '获取地图点位待审核任务失败')

    const bangumiTasks = Array.isArray(bangumiData.tasks) ? (bangumiData.tasks as TranslationTaskListItem[]) : []
    const pointTasks = Array.isArray(pointData.tasks) ? (pointData.tasks as TranslationTaskListItem[]) : []

    return [...bangumiTasks, ...pointTasks]
  }

  async function approveMapSampleBatch() {
    setSampleApproving(true)
    try {
      const pool = await loadReadyMapTasks(300)
      if (pool.length === 0) {
        toast.info('当前没有可抽检发布的地图 ready 任务')
        return
      }

      const sampleSize = Math.min(300, Math.max(50, Math.round(pool.length * 0.03)))
      const size = Math.min(sampleSize, pool.length)
      const shuffled = pool.slice().sort(() => Math.random() - 0.5)
      const sample = shuffled.slice(0, size)

      const accepted = await askForConfirm({
        title: '确认抽检并批量发布',
        description: `将从 ready 任务中抽取 ${size} 条样本并执行批量发布。`,
        confirmLabel: '确认发布',
        cancelLabel: '取消',
      })
      if (!accepted) return

      beginMapOpsProgress({
        title: '抽检并批量发布',
        totalSteps: 2,
        detail: `正在发布 ${size} 条抽检任务...`,
      })
      const res = await fetch('/api/admin/translations/approve-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskIds: sample.map((task) => task.id),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '抽检发布失败')
      patchMapOpsProgress({
        currentStep: 1,
        processed: Number(data.total || size),
        success: Number(data.approved || 0),
        failed: Number(data.failed || 0),
        skipped: Number(data.skipped || 0),
        errors: collectErrorMessages((data as { results?: unknown })?.results),
        detail: `抽检发布已应用：通过 ${data.approved || 0}，失败 ${data.failed || 0}，跳过 ${data.skipped || 0}。正在刷新列表...`,
      })

      setMapOpsMessage(`抽检发布完成：通过 ${data.approved || 0}，失败 ${data.failed || 0}，跳过 ${data.skipped || 0}`)
      toast.success(`抽检发布完成：通过 ${data.approved || 0}`)
      await Promise.all([loadTasks(), loadStats(), loadUntranslated()])
      patchMapOpsProgress({
        running: false,
        currentStep: 2,
        errors: collectErrorMessages((data as { results?: unknown })?.results),
        detail: `抽检发布完成：通过 ${data.approved || 0}，失败 ${data.failed || 0}，跳过 ${data.skipped || 0}`,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : '抽检发布失败'
      setMapOpsMessage(msg)
      patchMapOpsProgress({
        running: false,
        failed: mapOpsProgress ? mapOpsProgress.failed || 1 : 1,
        errors: [msg],
        detail: msg,
      })
      toast.error(msg)
    } finally {
      setSampleApproving(false)
    }
  }

  async function createTranslationTask(item: UntranslatedItem) {
    const accepted = await askForConfirm({
      title: '创建翻译任务',
      description: `确定为 "${item.title}" 创建翻译任务吗？`,
      confirmLabel: '确认创建',
      cancelLabel: '取消',
    })
    if (!accepted) return

    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: item.entityType,
          entityId: item.entityId,
          targetLanguages: item.missingLanguages,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '创建失败')
      }

      // Refresh related UI
      await Promise.all([loadTasks(), loadUntranslated(), loadStats()])
      toast.success(`已为 "${item.title}" 创建翻译任务`)
    } catch (error: any) {
      toast.error(error.message || '操作失败')
    }
  }

  useEffect(() => {
    void loadTasks()
  }, [debouncedQ, entityType, page, pageSize, status, targetLanguage, view])

  useEffect(() => {
    void loadStats()
  }, [entityType, targetLanguage])

  useEffect(() => {
    if (view === 'untranslated') {
      void loadUntranslated()
    }
  }, [entityType, untranslatedPage, untranslatedPageSize, untranslatedQuery, view])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total])
  const mapOpsProgressPercent = calcProgressPercent(mapOpsProgress)

  useEffect(() => {
    if (view !== 'tasks') return
    if (page <= totalPages) return
    setPage(totalPages)
  }, [page, totalPages, view])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('tasks')}
            className={
              view === 'tasks'
                ? 'rounded-md bg-brand-500 px-3 py-2 text-sm text-white'
                : 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50'
            }
          >
            翻译任务
          </button>
          <button
            type="button"
            onClick={() => setView('untranslated')}
            className={
              view === 'untranslated'
                ? 'rounded-md bg-brand-500 px-3 py-2 text-sm text-white'
                : 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50'
            }
          >
            未翻译内容
          </button>
        </div>
        <Button onClick={() => setShowBatchModal(true)} disabled={batchExecuting}>
          批量翻译
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">地图翻译控制区</div>
            <div className="mt-1 text-xs text-gray-500">
              回填历史任务、增量补队、一键自动推进/手动推进队列与抽检发布（en + ja，不依赖 cron）
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleMapBackfill('anitabi_bangumi')}
              disabled={mapOpsLoading || sampleApproving}
            >
              作品回填（1000）
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleMapBackfill('anitabi_point')}
              disabled={mapOpsLoading || sampleApproving}
            >
              点位回填（1000）
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleMapIncrementalRefill()}
              disabled={mapOpsLoading || sampleApproving}
            >
              增量补队
            </Button>
            <Button
              type="button"
              onClick={() => void handleOneKeyAdvanceMapQueue()}
              disabled={mapOpsLoading || sampleApproving}
            >
              一键自动推进
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void executeMapPendingBatch()}
              disabled={mapOpsLoading || sampleApproving}
            >
              执行地图待翻译（单轮）
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void executeMapFailedBatch()}
              disabled={mapOpsLoading || sampleApproving}
            >
              重试失败（单轮）
            </Button>
            <Button
              type="button"
              onClick={() => void handleManualAdvanceMapQueue(10)}
              disabled={mapOpsLoading || sampleApproving}
            >
              手动推进队列（10轮）
            </Button>
            <Button
              type="button"
              onClick={() => void approveMapSampleBatch()}
              disabled={mapOpsLoading || sampleApproving}
            >
              {sampleApproving ? '抽检发布中...' : '抽检并批量发布'}
            </Button>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          回填游标：作品 {bangumiBackfillCursor || '-'} / 点位 {pointBackfillCursor || '-'}
        </div>
        {mapOpsMessage ? (
          <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            {mapOpsMessage}
          </div>
        ) : null}
      </div>

      {batchProgress ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">批量任务进度</div>
              <div className="mt-1 text-sm text-gray-700">
                已处理 {batchProgress.processed} / {batchProgress.total}，成功 {batchProgress.success}，失败 {batchProgress.failed}，跳过 {batchProgress.skipped}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                状态：
                {batchProgress.running
                  ? '执行中'
                  : batchProgress.cancelled
                    ? '已中断'
                    : '已完成'}
                {batchProgress.currentTaskId ? ` · 当前任务 ${batchProgress.currentTaskId}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {batchProgress.running ? (
                <Button type="button" variant="ghost" onClick={cancelBatchExecution}>
                  中断执行
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setBatchProgress(null)}>
                  清除进度
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <Dialog.Root
        open={Boolean(mapOpsProgress)}
        onOpenChange={(open) => {
          if (!open && mapOpsProgress && !mapOpsProgress.running) {
            setMapOpsProgress(null)
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-lg border border-gray-200 bg-white p-5 shadow-xl">
            {mapOpsProgress ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-gray-900">{mapOpsProgress.title}</Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-gray-600">{mapOpsProgress.detail}</Dialog.Description>
                  </div>
                  {mapOpsProgress.running ? (
                    <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-brand-500" />
                  ) : (
                    <Dialog.Close className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                      <X className="h-4 w-4" />
                      <span className="sr-only">Close</span>
                    </Dialog.Close>
                  )}
                </div>

                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full bg-brand-500 transition-all duration-300 ${mapOpsProgress.running && mapOpsProgress.currentStep === 0 ? 'animate-pulse' : ''}`}
                      style={{ width: `${mapOpsProgressPercent}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {mapOpsProgress.running ? '处理中' : '已完成'}
                    </span>
                    <span>
                      步骤 {Math.max(0, Math.min(mapOpsProgress.currentStep, mapOpsProgress.totalSteps))} / {mapOpsProgress.totalSteps}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-5 gap-2 text-xs">
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-center text-gray-600">
                    处理 {mapOpsProgress.processed}
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-center text-emerald-700">
                    成功 {mapOpsProgress.success}
                  </div>
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-center text-rose-700">
                    翻译失败 {mapOpsProgress.failed}
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-center text-amber-700">
                    回收 {mapOpsProgress.reclaimed}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-center text-slate-600">
                    跳过 {mapOpsProgress.skipped}
                  </div>
                </div>

                {mapOpsProgress.errors.length > 0 ? (
                  <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
                    <div className="text-xs font-medium text-rose-700">失败原因</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-rose-700">
                      {mapOpsProgress.errors.slice(0, 4).map((message) => (
                        <li key={message} className="break-words">
                          {message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {!mapOpsProgress.running ? (
                  <div className="mt-4 flex justify-end">
                    <Button variant="ghost" onClick={() => setMapOpsProgress(null)}>
                      关闭
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {view === 'tasks' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex-1 min-w-[240px]">
              <label className="text-sm font-medium text-gray-700">搜索</label>
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(1)
                }}
                placeholder="标题 / slug / 任务ID / 实体ID"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div className="min-w-[140px]">
              <label className="text-sm font-medium text-gray-700">类型</label>
              <select
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value)
                  setPage(1)
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">全部</option>
                <option value="article">文章</option>
                <option value="city">城市</option>
                <option value="anime">动漫</option>
                <option value="anitabi_bangumi">地图作品</option>
                <option value="anitabi_point">地图地标</option>
              </select>
            </div>

            <div className="min-w-[140px]">
              <label className="text-sm font-medium text-gray-700">语言</label>
              <select
                value={targetLanguage}
                onChange={(e) => {
                  setTargetLanguage(e.target.value)
                  setPage(1)
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">全部</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
              </select>
            </div>

            <div className="min-w-[140px]">
              <label className="text-sm font-medium text-gray-700">每页</label>
              <select
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(clampInt(e.target.value, 20, { min: 5, max: 100 }))
                  setPage(1)
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>

            <Button
              variant="ghost"
              className="h-10"
              onClick={() => {
                setStatus('ready')
                setEntityType('all')
                setTargetLanguage('all')
                setQ('')
                setPage(1)
                setPageSize(20)
              }}
            >
              重置
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {statusTabs.map((t) => {
              const count = stats ? stats[t.key] : null
              const isActive = status === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setStatus(t.key)
                    setPage(1)
                  }}
                  className={
                    isActive
                      ? 'rounded-full bg-brand-500 px-3 py-1.5 text-sm text-white'
                      : 'rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
                  }
                >
                  <span>{t.label}</span>
                  {statsLoading ? (
                    <span className="ml-2 text-xs opacity-80">…</span>
                  ) : count != null ? (
                    <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-xs">
                      {count}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {tasksError ? (
            <AdminErrorState message={tasksError} onRetry={() => void loadTasks()} />
          ) : null}

          {tasksLoading ? <AdminSkeleton rows={8} /> : null}

          {!tasksLoading && !tasksError ? (
            <div className="space-y-3">
              {tasks.length === 0 ? (
                <AdminEmptyState title="暂无匹配的翻译任务" />
              ) : (
                tasks.map((task) => {
                  const links = buildPublicLinks(task)
                  const canOpenTarget = task.status === 'approved' || Boolean(task.target)
                  const dateLabel =
                    task.status === 'approved' ? '更新' : task.status === 'ready' ? '生成' : '更新'

                  return (
                    <div
                      key={task.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-300 transition-colors"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                              {entityTypeLabels[task.entityType] || task.entityType}
                            </span>
                            <span className="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                              {languageLabels[task.targetLanguage] || task.targetLanguage}
                            </span>
                            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                            {statusLabels[task.status] || task.status}
                          </span>
                          {task.target?.status ? (
                            <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                              译文:{articleStatusLabels[task.target.status] || task.target.status}
                            </span>
                          ) : null}
                        </div>

                          <div className="mt-2">
                            <Link
                              href={`/admin/translations/${task.id}`}
                              className="block truncate text-base font-semibold text-gray-900 hover:underline"
                              title={task.subject.title || task.id}
                            >
                              {task.subject.title || '(未命名内容)'}
                            </Link>
                            {task.subject.subtitle ? (
                              <div className="mt-1 text-xs text-gray-500">{task.subject.subtitle}</div>
                            ) : null}
                          </div>

                          {task.target?.title ? (
                            <div className="mt-2 text-sm text-gray-700">
                              <span className="text-gray-500">译文标题：</span>
                              <span className="font-medium">{task.target.title}</span>
                            </div>
                          ) : null}

                          {task.error ? (
                            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                              <strong>错误:</strong> {task.error}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                          <div className="text-xs text-gray-500">
                            {dateLabel}：{formatDateTime(task.updatedAt || task.createdAt)}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/admin/translations/${task.id}`}
                              className={
                                task.status === 'ready'
                                  ? 'rounded-md bg-amber-500 px-3 py-1 text-sm text-white hover:bg-amber-600'
                                  : 'rounded-md bg-brand-500 px-3 py-1 text-sm text-white hover:bg-brand-600'
                              }
                            >
                              {task.status === 'ready' ? '审核' : '查看'}
                            </Link>

                            {links.source ? (
                              <a
                                href={links.source}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                原文
                              </a>
                            ) : null}

                            {canOpenTarget && links.target ? (
                              <a
                                href={links.target}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                译文
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="text-sm text-gray-600">
              共 {total} 条 <span className="text-gray-300 mx-1">|</span> 第 {page} / {totalPages} 页 <span className="text-gray-300 mx-1">|</span> 每页 {pageSize}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="px-3 py-1.5"
                disabled={page <= 1 || tasksLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="ghost"
                className="px-3 py-1.5"
                disabled={tasksLoading || page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex-1 min-w-[240px]">
              <label className="text-sm font-medium text-gray-700">搜索标题</label>
              <input
                value={untranslatedQuery}
                onChange={(e) => {
                  setUntranslatedQuery(e.target.value)
                  setUntranslatedPage(1)
                }}
                placeholder="按标题筛选"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => {
                setUntranslatedQuery('')
                setUntranslatedPage(1)
                void loadUntranslated()
              }}
              disabled={untranslatedLoading}
            >
              刷新
            </Button>
          </div>

          {untranslatedLoading ? (
            <AdminSkeleton rows={8} />
          ) : untranslatedItems.length === 0 ? (
            <AdminEmptyState title="所有内容都已有翻译任务" />
          ) : (
            <div className="space-y-3">
              {untranslatedItems.map((item) => (
                <div
                  key={`${item.entityType}-${item.entityId}`}
                  className="rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-300 transition-colors"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                          {entityTypeLabels[item.entityType] || item.entityType}
                        </span>
                        <span className="font-medium text-gray-900">{item.title}</span>
                        <div className="flex flex-wrap gap-1">
                          {item.missingLanguages.map((lang) => (
                            <span
                              key={lang}
                              className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700"
                            >
                              缺失: {languageLabels[lang] || lang}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {formatDateTime(item.date)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="px-3 py-1 h-auto"
                        onClick={() => createTranslationTask(item)}
                      >
                        创建翻译任务
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-sm text-gray-600">
              共 {untranslatedTotal} 条 <span className="text-gray-300 mx-1">|</span> 第 {untranslatedPage} / {Math.max(1, Math.ceil(untranslatedTotal / untranslatedPageSize))} 页
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="px-3 py-1.5"
                disabled={untranslatedLoading || untranslatedPage <= 1}
                onClick={() => setUntranslatedPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="ghost"
                className="px-3 py-1.5"
                disabled={untranslatedLoading || untranslatedPage >= Math.max(1, Math.ceil(untranslatedTotal / untranslatedPageSize))}
                onClick={() => setUntranslatedPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog.Root open={showBatchModal} onOpenChange={setShowBatchModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 fade-in-0 animate-in" />
          <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95 sm:rounded-lg">
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
                批量翻译
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500">
                选择已创建但未执行的翻译任务，然后一键执行翻译。
              </Dialog.Description>
            </div>
            
            <div className="space-y-3 py-4">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">
                  共 {batchTaskItems.length} 个待翻译任务，已选择 {batchSelectedIds.length} 个
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={toggleBatchSelectAll}
                    disabled={batchLoading || batchTaskItems.length === 0}
                  >
                    {batchSelectedIds.length === batchTaskItems.length ? '取消全选' : '全选'}
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => setBatchSelectedIds([])}
                    disabled={batchLoading || batchSelectedIds.length === 0}
                  >
                    清空
                  </Button>
                </div>
              </div>

              {batchError ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {batchError}
                </div>
              ) : null}

              {batchLoading ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
                  正在加载待翻译任务...
                </div>
              ) : batchTaskItems.length === 0 ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-6 text-center text-sm text-green-700">
                  当前没有待执行翻译的任务
                </div>
              ) : (
                <div className="max-h-[360px] space-y-2 overflow-y-auto rounded-md border border-gray-200 p-2">
                  {batchTaskItems.map((task) => (
                    <label
                      key={task.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-100 p-2 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        checked={batchSelectedIds.includes(task.id)}
                        onChange={() => toggleBatchItem(task.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {entityTypeLabels[task.entityType] || task.entityType}
                          </span>
                          <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                            {languageLabels[task.targetLanguage] || task.targetLanguage}
                          </span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {statusLabels[task.status] || task.status}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-sm font-medium text-gray-900">
                          {task.subject.title || '(未命名内容)'}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {task.subject.subtitle || `任务 ID: ${task.id}`}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="ghost" onClick={() => setShowBatchModal(false)}>
                取消
              </Button>
              <Button 
                onClick={handleBatchSubmit} 
                disabled={batchLoading || batchExecuting || batchSelectedIds.length === 0}
              >
                {batchExecuting ? '执行中...' : '执行翻译'}
              </Button>
            </div>
            
            <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-gray-100 data-[state=open]:text-gray-500">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </div>
  )
}
