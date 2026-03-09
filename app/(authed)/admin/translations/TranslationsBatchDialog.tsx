'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import Button from '@/components/shared/Button'
import type { TranslationTaskListItem } from '@/lib/translation/adminDashboard'
import type { BatchScopeMode } from './useTranslationBatchExecution'

type TranslationsBatchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  batchScopeMode: BatchScopeMode
  setBatchScopeMode: (mode: BatchScopeMode) => void
  batchTaskItems: TranslationTaskListItem[]
  batchSelectedIds: string[]
  batchLoading: boolean
  batchExecuting: boolean
  batchError: string | null
  batchPage: number
  setBatchPage: (updater: (page: number) => number) => void
  batchPageSize: number
  batchTotal: number
  toggleBatchSelectAll: () => void
  clearSelection: () => void
  toggleBatchItem: (id: string) => void
  entityTypeLabels: Record<string, string>
  languageLabels: Record<string, string>
  statusLabels: Record<string, string>
  onSubmit: () => Promise<void>
}

export default function TranslationsBatchDialog(
  props: TranslationsBatchDialogProps
) {
  const {
    open,
    onOpenChange,
    batchScopeMode,
    setBatchScopeMode,
    batchTaskItems,
    batchSelectedIds,
    batchLoading,
    batchExecuting,
    batchError,
    batchPage,
    setBatchPage,
    batchPageSize,
    batchTotal,
    toggleBatchSelectAll,
    clearSelection,
    toggleBatchItem,
    entityTypeLabels,
    languageLabels,
    statusLabels,
    onSubmit,
  } = props

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 fade-in-0 animate-in" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95 sm:rounded-lg">
          <div className="flex flex-col space-y-1.5 text-center sm:text-left">
            <Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
              批量翻译
            </Dialog.Title>
            <Dialog.Description className="text-sm text-gray-500">
              选择当前页待执行任务，或直接执行当前筛选范围内全部 pending 任务。
            </Dialog.Description>
          </div>

          <div className="space-y-3 py-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setBatchScopeMode('selected_ids')}
                className={
                  batchScopeMode === 'selected_ids'
                    ? 'rounded-md border border-brand-500 bg-brand-50 px-3 py-2 text-left text-sm text-brand-700'
                    : 'rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50'
                }
              >
                执行当前页已选任务
              </button>
              <button
                type="button"
                onClick={() => setBatchScopeMode('all_matching_filter')}
                className={
                  batchScopeMode === 'all_matching_filter'
                    ? 'rounded-md border border-brand-500 bg-brand-50 px-3 py-2 text-left text-sm text-brand-700'
                    : 'rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50'
                }
              >
                执行当前筛选范围内全部 pending
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-gray-600">
                共 {batchTotal} 个 pending 任务，当前页 {batchTaskItems.length} 个，已选择 {batchSelectedIds.length} 个
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={toggleBatchSelectAll}
                  disabled={
                    batchLoading ||
                    batchTaskItems.length === 0 ||
                    batchScopeMode !== 'selected_ids'
                  }
                >
                  {batchSelectedIds.length === batchTaskItems.length ? '取消全选' : '全选'}
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={clearSelection}
                  disabled={
                    batchLoading ||
                    batchSelectedIds.length === 0 ||
                    batchScopeMode !== 'selected_ids'
                  }
                >
                  清空
                </Button>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              批量执行始终以 pending 队列为目标，并沿用当前的实体类型、目标语言和搜索词筛选。
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
                      disabled={batchScopeMode !== 'selected_ids'}
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

            <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
              <span>
                第 {batchPage} / {Math.max(1, Math.ceil(batchTotal / batchPageSize))} 页
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  disabled={batchLoading || batchPage <= 1}
                  onClick={() => setBatchPage((page) => Math.max(1, page - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  disabled={
                    batchLoading ||
                    batchPage >= Math.max(1, Math.ceil(batchTotal / batchPageSize))
                  }
                  onClick={() => setBatchPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              onClick={() => void onSubmit()}
              disabled={
                batchLoading ||
                batchExecuting ||
                (batchScopeMode === 'selected_ids' && batchSelectedIds.length === 0) ||
                batchTotal === 0
              }
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
  )
}
