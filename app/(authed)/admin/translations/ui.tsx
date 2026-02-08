'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import Button from '@/components/shared/Button'

type TranslationTaskListItem = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
  createdAt: string
  updatedAt: string
  error: string | null
  subject: {
    title: string | null
    subtitle: string | null
    slug: string | null
  }
  target:
    | {
        id: string
        title: string | null
        slug: string | null
        status: string | null
        publishedAt: string | null
        updatedAt: string | null
      }
    | null
}

type UntranslatedItem = {
  entityType: string
  entityId: string
  title: string
  date: string
  missingLanguages: string[]
}

type StatusKey = 'all' | 'pending' | 'processing' | 'ready' | 'approved' | 'failed'

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

  return {}
}

export default function TranslationsUI() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [view, setView] = useState<'tasks' | 'untranslated'>('tasks')

  const [status, setStatus] = useState<StatusKey>(() => {
    const raw = String(searchParams.get('status') || '').trim() as StatusKey
    return raw && (['all', 'pending', 'processing', 'ready', 'approved', 'failed'] as const).includes(raw)
      ? raw
      : 'ready'
  })
  const [entityType, setEntityType] = useState<string>(() => searchParams.get('entityType') || 'all')
  const [targetLanguage, setTargetLanguage] = useState<string>(() => searchParams.get('targetLanguage') || 'all')
  const [q, setQ] = useState<string>(() => searchParams.get('q') || '')
  const [page, setPage] = useState<number>(() => clampInt(searchParams.get('page'), 1, { min: 1, max: 10_000 }))
  const [pageSize, setPageSize] = useState<number>(() => clampInt(searchParams.get('pageSize'), 20, { min: 5, max: 100 }))

  const [debouncedQ, setDebouncedQ] = useState<string>(() => String(searchParams.get('q') || '').trim())

  const [tasks, setTasks] = useState<TranslationTaskListItem[]>([])
  const [total, setTotal] = useState(0)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)

  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  const [untranslatedItems, setUntranslatedItems] = useState<UntranslatedItem[]>([])
  const [untranslatedLoading, setUntranslatedLoading] = useState(false)
  const [untranslatedQuery, setUntranslatedQuery] = useState('')

  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchTaskItems, setBatchTaskItems] = useState<TranslationTaskListItem[]>([])
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchExecuting, setBatchExecuting] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)

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
    setBatchExecuting(true)
    setBatchError(null)
    try {
      const res = await fetch('/api/admin/translations/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: batchSelectedIds }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '批量执行失败')

      alert(`已执行 ${data.processed} 个，成功 ${data.success} 个，失败 ${data.failed} 个，跳过 ${data.skipped} 个`)
      setShowBatchModal(false)
      await Promise.all([loadTasks(), loadUntranslated(), loadStats()])
    } catch (error: any) {
      const msg = error?.message || '操作失败'
      setBatchError(msg)
      alert(msg)
    } finally {
      setBatchExecuting(false)
    }
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
      if ((error as any)?.name === 'AbortError') return
      const msg = error instanceof Error ? error.message : '加载失败'
      setTasksError(msg)
    } finally {
      if (taskAbort.current === controller) taskAbort.current = null
      setTasksLoading(false)
    }
  }

  async function loadStats() {
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
      if ((error as any)?.name === 'AbortError') return
      setStats(null)
    } finally {
      if (statsAbort.current === controller) statsAbort.current = null
      setStatsLoading(false)
    }
  }

  async function loadUntranslated() {
    setUntranslatedLoading(true)
    try {
      const res = await fetch('/api/admin/translations/untranslated')
      const data = await res.json()
      setUntranslatedItems(data.items || [])
    } catch (error) {
      console.error('Failed to load untranslated items', error)
    } finally {
      setUntranslatedLoading(false)
    }
  }

  async function createTranslationTask(item: UntranslatedItem) {
    if (!confirm(`确定为 "${item.title}" 创建翻译任务吗？`)) return

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
    } catch (error: any) {
      alert(error.message || '操作失败')
    }
  }

  useEffect(() => {
    void loadTasks()
  }, [debouncedQ, entityType, page, pageSize, status, targetLanguage, view])

  useEffect(() => {
    void loadStats()
  }, [entityType, targetLanguage])

  useEffect(() => {
    if (view === 'untranslated' && untranslatedItems.length === 0) {
      void loadUntranslated()
    }
  }, [untranslatedItems.length, view])

  const filteredUntranslated = useMemo(() => {
    const needle = untranslatedQuery.trim()
    if (!needle) return untranslatedItems
    const lower = needle.toLowerCase()
    return untranslatedItems.filter((it) => it.title.toLowerCase().includes(lower))
  }, [untranslatedItems, untranslatedQuery])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total])

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
        <Button onClick={() => setShowBatchModal(true)}>批量翻译</Button>
      </div>

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
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {tasksError}
            </div>
          ) : null}

          {tasksLoading ? <div className="text-gray-600">加载中…</div> : null}

          {!tasksLoading && !tasksError ? (
            <div className="space-y-3">
              {tasks.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-600">
                  暂无匹配的翻译任务
                </div>
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
                onChange={(e) => setUntranslatedQuery(e.target.value)}
                placeholder="按标题筛选"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => {
                setUntranslatedQuery('')
                void loadUntranslated()
              }}
              disabled={untranslatedLoading}
            >
              刷新
            </Button>
          </div>

          {untranslatedLoading ? (
            <div className="text-gray-500">加载中...</div>
          ) : filteredUntranslated.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-green-50 p-8 text-center text-green-700">
              所有内容都已有翻译任务
            </div>
          ) : (
            <div className="space-y-3">
              {filteredUntranslated.map((item) => (
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
