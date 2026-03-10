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
import { createTranslationsMapActions } from './mapActions'
import TranslationsPageView from './TranslationsPageView'
import { useTranslationBatchExecution } from './useTranslationBatchExecution'
import {
  buildPublicLinks,
  buildStatsSignature,
  buildTaskSignature,
  calcOneKeyProgressPercent,
  calcProgressPercent,
  clampInt,
  formatDateTime,
  formatMetricCount,
  isAbortError,
  isStatusKey,
  type MapOpsProgress,
  type StatusKey,
  type TranslationsUIProps,
  type UntranslatedItem,
} from './helpers'

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
  const [mapOpsLoading, setMapOpsLoading] = useState(false)
  const [mapOpsMessage, setMapOpsMessage] = useState<string | null>(null)
  const [showMapOpsPanel, setShowMapOpsPanel] = useState<boolean>(
    () => initialQuery?.entityType === 'anitabi_bangumi' || initialQuery?.entityType === 'anitabi_point'
  )
  const [mapOpsProgress, setMapOpsProgress] = useState<MapOpsProgress | null>(null)
  const [bangumiBackfillCursor, setBangumiBackfillCursor] = useState<string | null>(null)
  const [pointBackfillCursor, setPointBackfillCursor] = useState<string | null>(null)
  const [sampleApproving, setSampleApproving] = useState(false)
  const [approveAllReadyRunning, setApproveAllReadyRunning] = useState(false)

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
    zh: '中文',
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
      terminalState: 'running',
      currentStep: 0,
      totalSteps: Math.max(1, input.totalSteps),
      processed: 0,
      success: 0,
      failed: 0,
      reclaimed: 0,
      skipped: 0,
      errors: [],
      oneKey: null,
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

  const reloadAll = async () => {
    await Promise.all([
      loadTasks(),
      loadStats(),
      view === 'untranslated' ? loadUntranslated() : Promise.resolve(),
    ])
  }

  const {
    showBatchModal,
    setShowBatchModal,
    batchTaskItems,
    batchSelectedIds,
    setBatchSelectedIds,
    batchLoading,
    batchExecuting,
    batchError,
    batchProgress,
    setBatchProgress,
    batchScopeMode,
    setBatchScopeMode,
    batchPage,
    setBatchPage,
    batchPageSize,
    batchTotal,
    cancelBatchExecution,
    toggleBatchSelectAll,
    toggleBatchItem,
    handleBatchSubmit,
  } = useTranslationBatchExecution({
    entityType,
    targetLanguage,
    q: debouncedQ,
    toast,
    reloadAll,
  })

  const mapActions = createTranslationsMapActions({
    targetLanguage,
    bangumiBackfillCursor,
    pointBackfillCursor,
    entityTypeLabels,
    askForConfirm,
    toast,
    setMapOpsLoading,
    setMapOpsMessage,
    setBangumiBackfillCursor,
    setPointBackfillCursor,
    setSampleApproving,
    setApproveAllReadyRunning,
    beginMapOpsProgress,
    patchMapOpsProgress,
    reloadAll,
  })

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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
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
  const oneKeyProgressPercent = calcOneKeyProgressPercent(mapOpsProgress)
  const mapControlsBusy = mapOpsLoading || sampleApproving || approveAllReadyRunning

  useEffect(() => {
    if (view !== 'tasks') return
    if (page <= totalPages) return
    setPage(totalPages)
  }, [page, totalPages, view])

  return (
    <TranslationsPageView
      view={view}
      setView={setView}
      setShowBatchModal={setShowBatchModal}
      batchExecuting={batchExecuting}
      showMapOpsPanel={showMapOpsPanel}
      setShowMapOpsPanel={setShowMapOpsPanel}
      mapActions={mapActions}
      mapControlsBusy={mapControlsBusy}
      approveAllReadyRunning={approveAllReadyRunning}
      sampleApproving={sampleApproving}
      bangumiBackfillCursor={bangumiBackfillCursor}
      pointBackfillCursor={pointBackfillCursor}
      mapOpsMessage={mapOpsMessage}
      batchProgress={batchProgress}
      cancelBatchExecution={cancelBatchExecution}
      setBatchProgress={setBatchProgress}
      mapOpsProgress={mapOpsProgress}
      setMapOpsProgress={setMapOpsProgress}
      mapOpsProgressPercent={mapOpsProgressPercent}
      formatMetricCount={formatMetricCount}
      oneKeyProgressPercent={oneKeyProgressPercent}
      q={q}
      setQ={setQ}
      setPage={setPage}
      entityType={entityType}
      setEntityType={setEntityType}
      targetLanguage={targetLanguage}
      setTargetLanguage={setTargetLanguage}
      pageSize={pageSize}
      setPageSize={setPageSize}
      clampInt={clampInt}
      setStatus={setStatus}
      statusTabs={statusTabs}
      stats={stats}
      statsLoading={statsLoading}
      status={status}
      tasksError={tasksError}
      loadTasks={loadTasks}
      tasksLoading={tasksLoading}
      tasks={tasks}
      buildPublicLinks={buildPublicLinks}
      entityTypeLabels={entityTypeLabels}
      languageLabels={languageLabels}
      statusLabels={statusLabels}
      articleStatusLabels={articleStatusLabels}
      formatDateTime={formatDateTime}
      total={total}
      page={page}
      totalPages={totalPages}
      untranslatedQuery={untranslatedQuery}
      setUntranslatedQuery={setUntranslatedQuery}
      setUntranslatedPage={setUntranslatedPage}
      loadUntranslated={loadUntranslated}
      untranslatedLoading={untranslatedLoading}
      untranslatedItems={untranslatedItems}
      untranslatedTotal={untranslatedTotal}
      untranslatedPage={untranslatedPage}
      untranslatedPageSize={untranslatedPageSize}
      createTranslationTask={createTranslationTask}
      showBatchModal={showBatchModal}
      batchTaskItems={batchTaskItems}
      batchSelectedIds={batchSelectedIds}
      batchScopeMode={batchScopeMode}
      setBatchScopeMode={setBatchScopeMode}
      batchPage={batchPage}
      setBatchPage={setBatchPage}
      batchPageSize={batchPageSize}
      batchTotal={batchTotal}
      toggleBatchSelectAll={toggleBatchSelectAll}
      batchLoading={batchLoading}
      setBatchSelectedIds={setBatchSelectedIds}
      batchError={batchError}
      toggleBatchItem={toggleBatchItem}
      handleBatchSubmit={handleBatchSubmit}
    />
  )
}
