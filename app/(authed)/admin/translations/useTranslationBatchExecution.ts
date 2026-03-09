'use client'

import { useEffect, useRef, useState } from 'react'
import type { TranslationTaskListItem } from '@/lib/translation/adminDashboard'
import type { BatchExecutionProgress } from './helpers'

export type BatchScopeMode = 'selected_ids' | 'all_matching_filter'

type ToastApi = {
  success: (message: string, title?: string) => unknown
  info: (message: string, title?: string) => unknown
  error: (message: string, title?: string) => unknown
}

type UseTranslationBatchExecutionInput = {
  entityType: string
  targetLanguage: string
  q: string
  toast: ToastApi
  reloadAll: () => Promise<void>
}

type ExecuteSummary = {
  total: number
  success: number
  failed: number
  skipped: number
}

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = []
  for (let index = 0; index < ids.length; index += size) {
    out.push(ids.slice(index, index + size))
  }
  return out
}

async function postExecute(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/translations/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(String(data.error || '批量执行失败'))
  }
  return data as {
    total?: number
    success?: number
    failed?: number
    skipped?: number
  }
}

export function useTranslationBatchExecution(
  input: UseTranslationBatchExecutionInput
) {
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchTaskItems, setBatchTaskItems] = useState<TranslationTaskListItem[]>([])
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchExecuting, setBatchExecuting] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<BatchExecutionProgress | null>(null)
  const [batchScopeMode, setBatchScopeMode] =
    useState<BatchScopeMode>('selected_ids')
  const [batchPage, setBatchPage] = useState(1)
  const [batchPageSize] = useState(50)
  const [batchTotal, setBatchTotal] = useState(0)

  const batchCancelRef = useRef(false)

  async function loadBatchTaskItems() {
    setBatchLoading(true)
    setBatchError(null)
    try {
      const params = new URLSearchParams()
      params.set('status', 'pending')
      if (input.entityType !== 'all') params.set('entityType', input.entityType)
      if (input.targetLanguage !== 'all') {
        params.set('targetLanguage', input.targetLanguage)
      }
      if (input.q.trim()) params.set('q', input.q.trim())
      params.set('page', String(batchPage))
      params.set('pageSize', String(batchPageSize))

      const res = await fetch(`/api/admin/translations?${params.toString()}`, {
        method: 'GET',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(data.error || '加载待翻译任务失败'))

      const rows = Array.isArray(data.tasks)
        ? (data.tasks as TranslationTaskListItem[])
        : []
      setBatchTaskItems(rows)
      setBatchTotal(
        typeof data.total === 'number'
          ? data.total
          : Number.parseInt(String(data.total || 0), 10) || 0
      )
      setBatchSelectedIds(rows.map((task) => task.id))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '加载待翻译任务失败'
      setBatchTaskItems([])
      setBatchSelectedIds([])
      setBatchTotal(0)
      setBatchError(message)
    } finally {
      setBatchLoading(false)
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
    setBatchSelectedIds(batchTaskItems.map((task) => task.id))
  }

  function toggleBatchItem(id: string) {
    setBatchSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((value) => value !== id)
      return [...prev, id]
    })
  }

  async function runSelectedIdsExecution(selectedIds: string[]) {
    const chunks = chunkIds(selectedIds, 25)
    const aggregate: ExecuteSummary = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    }

    for (const [index, taskIds] of chunks.entries()) {
      if (batchCancelRef.current) break
      setBatchProgress((prev) =>
        prev
          ? {
              ...prev,
              currentTaskId: `${index + 1}/${chunks.length}`,
            }
          : prev
      )
      const data = await postExecute({ taskIds })
      aggregate.total += Number(data.total || taskIds.length)
      aggregate.success += Number(data.success || 0)
      aggregate.failed += Number(data.failed || 0)
      aggregate.skipped += Number(data.skipped || 0)
      setBatchProgress((prev) =>
        prev
          ? {
              ...prev,
              processed: aggregate.total,
              success: aggregate.success,
              failed: aggregate.failed,
              skipped: aggregate.skipped,
            }
          : prev
      )
    }

    return aggregate
  }

  async function runFilterExecution() {
    const aggregate: ExecuteSummary = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    }

    for (;;) {
      if (batchCancelRef.current) break
      const data = await postExecute({
        entityType: input.entityType === 'all' ? undefined : input.entityType,
        targetLanguage:
          input.targetLanguage === 'all' ? undefined : input.targetLanguage,
        q: input.q.trim() || undefined,
        limit: 100,
        statusScope: 'pending',
        concurrency: 4,
      })
      const roundTotal = Number(data.total || 0)
      if (roundTotal <= 0) break
      aggregate.total += roundTotal
      aggregate.success += Number(data.success || 0)
      aggregate.failed += Number(data.failed || 0)
      aggregate.skipped += Number(data.skipped || 0)
      setBatchProgress((prev) =>
        prev
          ? {
              ...prev,
              processed: aggregate.total,
              success: aggregate.success,
              failed: aggregate.failed,
              skipped: aggregate.skipped,
              currentTaskId: `剩余执行中`,
            }
          : prev
      )

      if (roundTotal < 100) break
    }

    return aggregate
  }

  async function handleBatchSubmit() {
    if (batchScopeMode === 'selected_ids' && batchSelectedIds.length === 0) {
      return
    }

    batchCancelRef.current = false
    setBatchExecuting(true)
    setBatchError(null)
    setShowBatchModal(false)
    setBatchProgress({
      total:
        batchScopeMode === 'selected_ids'
          ? batchSelectedIds.length
          : Math.max(batchTotal, 1),
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

    try {
      const aggregate =
        batchScopeMode === 'selected_ids'
          ? await runSelectedIdsExecution([...batchSelectedIds])
          : await runFilterExecution()

      const cancelled = batchCancelRef.current
      setBatchProgress((prev) =>
        prev
          ? {
              ...prev,
              total:
                batchScopeMode === 'selected_ids'
                  ? prev.total
                  : Math.max(prev.total, aggregate.total),
              running: false,
              cancelled,
              finishedAt: Date.now(),
              currentTaskId: null,
            }
          : prev
      )

      if (cancelled) {
        input.toast.info(
          `已中断，已处理 ${aggregate.total} 个（成功 ${aggregate.success}，失败 ${aggregate.failed}，跳过 ${aggregate.skipped}）`,
          '批量翻译已中断'
        )
      } else {
        input.toast.success(
          `已执行 ${aggregate.total} 个，成功 ${aggregate.success} 个，失败 ${aggregate.failed} 个，跳过 ${aggregate.skipped} 个`
        )
      }

      setBatchSelectedIds([])
      await input.reloadAll()
    } catch (error) {
      const message = error instanceof Error ? error.message : '批量执行失败'
      setBatchError(message)
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
      input.toast.error(message)
    } finally {
      setBatchExecuting(false)
    }
  }

  useEffect(() => {
    if (!showBatchModal) return
    void loadBatchTaskItems()
  }, [
    batchPage,
    batchPageSize,
    input.entityType,
    input.q,
    input.targetLanguage,
    showBatchModal,
  ])

  return {
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
  }
}
