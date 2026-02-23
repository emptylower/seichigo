'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { RouteBookStatus, RouteBookZone } from '@/lib/routeBook/repo'
import CheckInModal from '@/components/checkin/CheckInModal'

type PointRecord = {
  id: string
  routeBookId: string
  pointId: string
  sortOrder: number
  zone: RouteBookZone
  createdAt: string
}

type PointPoolItem = {
  id: string
  pointId: string
  createdAt: string
  updatedAt: string
}

type RouteBookDetail = {
  id: string
  title: string
  status: RouteBookStatus
  metadata: unknown | null
  createdAt: string
  updatedAt: string
  points: PointRecord[]
}

type DetailResponse =
  | { ok: true; routeBook?: RouteBookDetail; item?: RouteBookDetail }
  | { error: string }

type PointPreview = {
  title: string
  subtitle: string
  image: string | null
}

type BangumiResponse = {
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
  }>
}

const STATUS_LABEL: Record<RouteBookStatus, string> = {
  draft: '草稿',
  in_progress: '进行中',
  completed: '已完成',
}

const STATUS_STYLE: Record<RouteBookStatus, string> = {
  draft: 'bg-white/75 text-slate-700',
  in_progress: 'bg-sky-500/85 text-white',
  completed: 'bg-emerald-500/85 text-white',
}

const STATUS_ACTION_CLASS: Record<RouteBookStatus, string> = {
  draft: 'bg-blue-500 hover:bg-blue-600 text-white',
  in_progress: 'bg-green-500 hover:bg-green-600 text-white',
  completed: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
}

const POINT_FALLBACK_GRADIENTS = [
  'from-sky-500/85 via-cyan-400/80 to-brand-300/80',
  'from-brand-500/85 via-rose-400/80 to-orange-300/75',
  'from-violet-500/80 via-fuchsia-400/75 to-brand-400/75',
  'from-emerald-500/80 via-teal-400/75 to-cyan-300/75',
] as const

const SORTED_LIMIT = 25

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '最近更新'
  return parsed.toLocaleDateString('zh-CN')
}

function parseBangumiId(pointId: string): number | null {
  const [raw] = pointId.split(':')
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parsePointKey(pointId: string): string {
  const sep = pointId.indexOf(':')
  if (sep < 0) return pointId
  return pointId.slice(sep + 1)
}

function pickPointGradient(seed: string): string {
  let value = 0
  for (const char of seed) value = (value * 29 + char.charCodeAt(0)) % 997
  return POINT_FALLBACK_GRADIENTS[value % POINT_FALLBACK_GRADIENTS.length]
}

function buildFallbackPreview(pointId: string): PointPreview {
  return {
    title: `点位 ${parsePointKey(pointId)}`,
    subtitle: `番剧 #${parseBangumiId(pointId) || '未知'}`,
    image: null,
  }
}

function PointThumb({ preview, seed }: { preview: PointPreview; seed: string }) {
  const gradient = pickPointGradient(seed)

  if (preview.image) {
    return (
      <img
        src={preview.image}
        alt={preview.title}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
    )
  }

  return (
    <div className={`flex h-full w-full items-end bg-gradient-to-br ${gradient}`}>
      <div className="w-full bg-[linear-gradient(to_top,rgba(2,6,23,0.78),rgba(2,6,23,0.25),transparent)] px-2.5 py-2 text-[11px] font-semibold text-white">
        {preview.subtitle}
      </div>
    </div>
  )
}

function PointCard({
  point,
  preview,
  indexLabel,
  onRemove,
  onMoveToSorted,
  onMoveToUnsorted,
  canMoveToSorted,
}: {
  point: PointRecord
  preview: PointPreview
  indexLabel?: string
  onRemove: (pointId: string) => void
  onMoveToSorted?: () => void
  onMoveToUnsorted?: () => void
  canMoveToSorted: boolean
}) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-pink-100/90 bg-white shadow-[0_14px_30px_-25px_rgba(15,23,42,0.45)]">
      <div className="relative aspect-[16/9] overflow-hidden border-b border-pink-50/90">
        <PointThumb preview={preview} seed={point.pointId} />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,6,23,0.72)_9%,rgba(2,6,23,0.08)_55%,rgba(255,255,255,0)_100%)]" />
        <div className="absolute left-3 top-3 inline-flex rounded-full border border-white/55 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700 backdrop-blur-sm">
          {point.zone === 'sorted' ? '路线中' : '待排中'}
        </div>
        {indexLabel ? (
          <div className="absolute right-3 top-3 inline-flex rounded-full border border-white/50 bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
            {indexLabel}
          </div>
        ) : null}
        <div className="absolute bottom-3 left-3 right-3">
          <div className="line-clamp-2 text-base font-semibold leading-tight text-white drop-shadow-sm">{preview.title}</div>
        </div>
      </div>

      <div className="space-y-3 p-3.5">
        <p className="line-clamp-1 text-sm text-slate-500">{preview.subtitle}</p>
        <p className="truncate rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-500">{point.pointId}</p>
        <div className="flex flex-wrap items-center gap-2">
          {onMoveToSorted ? (
            <button
              type="button"
              disabled={!canMoveToSorted}
              className="inline-flex min-h-9 flex-1 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-medium text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={onMoveToSorted}
              title={canMoveToSorted ? '移入路线' : `已排序区最多 ${SORTED_LIMIT} 个`}
            >
              加入路线
            </button>
          ) : null}
          {onMoveToUnsorted ? (
            <button
              type="button"
              className="inline-flex min-h-9 flex-1 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
              onClick={onMoveToUnsorted}
            >
              移出路线
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-9 flex-1 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
            onClick={() => onRemove(point.pointId)}
          >
            移除
          </button>
        </div>
      </div>
    </article>
  )
}

function SortablePointCard({
  point,
  preview,
  onRemove,
  onMoveToUnsorted,
  canMoveToSorted,
}: {
  point: PointRecord
  preview: PointPreview
  onRemove: (pointId: string) => void
  onMoveToUnsorted: () => void
  canMoveToSorted: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: point.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5">#{point.sortOrder + 1}</span>
          <span>拖拽可排序</span>
        </div>
        <button
          type="button"
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
          {...attributes}
          {...listeners}
          aria-label="拖拽排序"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="3" r="1.5" />
            <circle cx="11" cy="3" r="1.5" />
            <circle cx="5" cy="8" r="1.5" />
            <circle cx="11" cy="8" r="1.5" />
            <circle cx="5" cy="13" r="1.5" />
            <circle cx="11" cy="13" r="1.5" />
          </svg>
        </button>
      </div>
      <PointCard
        point={point}
        preview={preview}
        indexLabel={`#${point.sortOrder + 1}`}
        onRemove={onRemove}
        onMoveToUnsorted={onMoveToUnsorted}
        canMoveToSorted={canMoveToSorted}
      />
    </div>
  )
}

export default function RouteBookDetailClient({ id }: { id: string }) {
  const [routeBook, setRouteBook] = useState<RouteBookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [checkedInPointIds, setCheckedInPointIds] = useState<Set<string>>(new Set())
  const [checkInTarget, setCheckInTarget] = useState<string | null>(null)
  const [pointPoolItems, setPointPoolItems] = useState<PointPoolItem[]>([])
  const [pointPreviewById, setPointPreviewById] = useState<Record<string, PointPreview>>({})

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rbRes, psRes, poolRes] = await Promise.all([
        fetch(`/api/me/routebooks/${id}`),
        fetch('/api/me/point-states?state=checked_in'),
        fetch('/api/me/point-pool'),
      ])
      const rbData = (await rbRes.json().catch(() => ({}))) as DetailResponse
      if (!rbRes.ok || 'error' in rbData) {
        setError(('error' in rbData && rbData.error) || '加载失败')
        return
      }

      const detail = rbData.routeBook || rbData.item || null
      if (!detail) {
        setError('地图数据异常，请刷新重试')
        return
      }

      setRouteBook(detail)
      setTitleDraft(detail.title)

      const psData = await psRes.json().catch(() => ({}))
      if (psData.ok && Array.isArray(psData.items)) {
        setCheckedInPointIds(new Set(psData.items.map((s: { pointId: string }) => s.pointId)))
      }

      const poolData = await poolRes.json().catch(() => ({}))
      if (poolData.ok && Array.isArray(poolData.items)) {
        setPointPoolItems(
          poolData.items.filter((item: unknown): item is PointPoolItem => {
            if (!item || typeof item !== 'object') return false
            const row = item as Record<string, unknown>
            return typeof row.id === 'string' && typeof row.pointId === 'string'
          })
        )
      } else {
        setPointPoolItems([])
      }
    } catch {
      setError('加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const unsorted = routeBook?.points.filter((p) => p.zone === 'unsorted') ?? []
  const sorted = routeBook?.points
    .filter((p) => p.zone === 'sorted')
    .sort((a, b) => a.sortOrder - b.sortOrder) ?? []

  const allPointIds = useMemo(() => {
    const pointIds = [
      ...(routeBook?.points.map((point) => point.pointId) ?? []),
      ...pointPoolItems.map((item) => item.pointId),
    ]
    return Array.from(new Set(pointIds))
  }, [routeBook, pointPoolItems])

  const unresolvedPointIds = useMemo(() => {
    return allPointIds.filter((pointId) => !pointPreviewById[pointId])
  }, [allPointIds, pointPreviewById])

  useEffect(() => {
    if (!unresolvedPointIds.length) return

    const grouped = new Map<number, string[]>()
    const fallbackPreviews: Record<string, PointPreview> = {}

    for (const pointId of unresolvedPointIds) {
      const bangumiId = parseBangumiId(pointId)
      if (!bangumiId) {
        fallbackPreviews[pointId] = buildFallbackPreview(pointId)
        continue
      }
      const list = grouped.get(bangumiId) ?? []
      list.push(pointId)
      grouped.set(bangumiId, list)
    }

    if (Object.keys(fallbackPreviews).length > 0) {
      setPointPreviewById((prev) => ({ ...prev, ...fallbackPreviews }))
    }

    if (!grouped.size) return

    let cancelled = false

    void (async () => {
      const loadedPreviews: Record<string, PointPreview> = {}

      await Promise.all(
        Array.from(grouped.entries()).map(async ([bangumiId, ids]) => {
          try {
            const res = await fetch(`/api/anitabi/bangumi/${bangumiId}`)
            if (!res.ok) return
            const data = (await res.json().catch(() => null)) as BangumiResponse | null
            if (!data) return

            const pointMap = new Map<string, { title: string; image: string | null }>()
            for (const point of data.points || []) {
              if (!point?.id) continue
              const title = (point.nameZh || point.name || point.id || '').trim()
              if (!title) continue
              pointMap.set(point.id, {
                title,
                image: typeof point.image === 'string' ? point.image : null,
              })
            }

            const subtitle =
              (typeof data.card?.titleZh === 'string' && data.card.titleZh.trim()) ||
              (typeof data.card?.title === 'string' && data.card.title.trim()) ||
              `作品 #${bangumiId}`
            const cover = typeof data.card?.cover === 'string' ? data.card.cover : null

            for (const pointId of ids) {
              const key = parsePointKey(pointId)
              const matched = pointMap.get(key)
              loadedPreviews[pointId] = {
                title: matched?.title || `点位 ${key}`,
                subtitle,
                image: matched?.image || cover,
              }
            }
          } catch {
            for (const pointId of ids) {
              loadedPreviews[pointId] = buildFallbackPreview(pointId)
            }
          }
        })
      )

      if (cancelled) return

      setPointPreviewById((prev) => {
        const next = { ...prev }
        for (const pointId of unresolvedPointIds) {
          next[pointId] = loadedPreviews[pointId] || next[pointId] || buildFallbackPreview(pointId)
        }
        return next
      })
    })()

    return () => {
      cancelled = true
    }
  }, [unresolvedPointIds])

  const getPointPreview = useCallback((pointId: string) => {
    return pointPreviewById[pointId] || buildFallbackPreview(pointId)
  }, [pointPreviewById])

  async function handleTitleSave() {
    const title = titleDraft.trim()
    if (!title || !routeBook || title === routeBook.title) {
      setEditingTitle(false)
      return
    }
    const res = await fetch(`/api/me/routebooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (res.ok) {
      setRouteBook((prev) => prev ? { ...prev, title } : prev)
    }
    setEditingTitle(false)
  }

  async function handleStatusChange(status: RouteBookStatus) {
    if (!routeBook) return
    const res = await fetch(`/api/me/routebooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setRouteBook((prev) => prev ? { ...prev, status } : prev)
    }
  }

  async function handleRemovePoint(pointId: string) {
    const res = await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointId }),
    })
    if (res.ok) {
      setRouteBook((prev) => prev ? {
        ...prev,
        points: prev.points.filter((p) => p.pointId !== pointId),
      } : prev)
    }
  }

  async function handleMoveToZone(pointId: string, targetZone: RouteBookZone) {
    if (!routeBook) return

    const updatedPoints = routeBook.points.map((p) => {
      if (p.pointId === pointId) {
        const newSortOrder = targetZone === 'sorted'
          ? sorted.length
          : 0
        return { ...p, zone: targetZone, sortOrder: newSortOrder }
      }
      return p
    })
    setRouteBook({ ...routeBook, points: updatedPoints })

    await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointId }),
    })
    await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointId, zone: targetZone }),
    })

    void load()
  }

  async function handleAddFromPointPool(pointId: string) {
    const res = await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointId, zone: 'unsorted' }),
    })
    if (!res.ok) return
    await load()
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || !routeBook) return

    const oldIndex = sorted.findIndex((p) => p.id === active.id)
    const newIndex = sorted.findIndex((p) => p.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(sorted, oldIndex, newIndex)
    const updatedPoints = routeBook.points.map((p) => {
      if (p.zone !== 'sorted') return p
      const idx = reordered.findIndex((r) => r.id === p.id)
      return idx >= 0 ? { ...p, sortOrder: idx } : p
    })
    setRouteBook({ ...routeBook, points: updatedPoints })

    await fetch(`/api/me/routebooks/${id}/points`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointIds: reordered.map((p) => p.pointId) }),
    })
  }

  function generateGoogleMapsUrl() {
    if (sorted.length === 0) return null
    const base = 'https://www.google.com/maps/dir/'
    const waypoints = sorted.map((p) => p.pointId).join('/')
    return `${base}${waypoints}`
  }

  if (loading) return <div className="text-gray-600">加载中…</div>
  if (error) return (
    <div className="space-y-4">
      <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div>
      <a href="/me/routebooks" className="text-sm text-brand-600 hover:underline">返回地图列表</a>
    </div>
  )
  if (!routeBook) return null

  const canAddToSorted = sorted.length < SORTED_LIMIT

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[30px] border border-pink-100/90 bg-[linear-gradient(150deg,rgba(255,255,255,0.95),rgba(253,242,248,0.88))] p-5 shadow-[0_22px_45px_-30px_rgba(219,39,119,0.45)] sm:p-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [background-size:36px_36px]" />
        <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-cyan-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-40 w-40 rounded-full bg-brand-200/50 blur-3xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            {editingTitle ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={100}
                  className="w-full max-w-xl rounded-xl border border-slate-300 bg-white px-3 py-2 text-lg font-semibold focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleTitleSave()
                    if (e.key === 'Escape') setEditingTitle(false)
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
                  onClick={() => void handleTitleSave()}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => { setEditingTitle(false); setTitleDraft(routeBook.title) }}
                >
                  取消
                </button>
              </div>
            ) : (
              <h1
                className="cursor-pointer text-2xl font-bold tracking-tight text-slate-900 transition hover:text-brand-600 sm:text-3xl"
                onClick={() => setEditingTitle(true)}
                title="点击编辑标题"
              >
                {routeBook.title}
              </h1>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className={`inline-flex rounded-full border border-white/50 px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${STATUS_STYLE[routeBook.status]}`}>
                {STATUS_LABEL[routeBook.status]}
              </span>
              <span>更新于 {formatDate(routeBook.updatedAt)}</span>
            </div>
          </div>

          <a
            href="/me/routebooks"
            className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 no-underline transition hover:bg-slate-50"
          >
            返回列表
          </a>
        </div>

        <div className="relative mt-4 flex flex-wrap gap-2">
          {routeBook.status === 'draft' && (
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${STATUS_ACTION_CLASS.draft}`}
              onClick={() => void handleStatusChange('in_progress')}
            >
              开始巡礼
            </button>
          )}
          {routeBook.status === 'in_progress' && (
            <>
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${STATUS_ACTION_CLASS.in_progress}`}
                onClick={() => void handleStatusChange('completed')}
              >
                完成巡礼
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                onClick={() => void handleStatusChange('draft')}
              >
                回到草稿
              </button>
            </>
          )}
          {routeBook.status === 'completed' && (
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${STATUS_ACTION_CLASS.completed}`}
              onClick={() => void handleStatusChange('draft')}
            >
              重新编辑
            </button>
          )}
          {sorted.length > 0 && (
            <a
              href={generateGoogleMapsUrl() ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 no-underline transition hover:bg-slate-50"
            >
              在 Google Maps 中查看路线
            </a>
          )}
        </div>
      </section>

      {routeBook.status === 'in_progress' && sorted.length > 0 && (() => {
        const nextPoint = sorted.find((p) => !checkedInPointIds.has(p.pointId))
        const checkedCount = sorted.filter((p) => checkedInPointIds.has(p.pointId)).length
        const allDone = checkedCount === sorted.length

        if (allDone) {
          return (
            <div className="rounded-2xl border-2 border-green-200 bg-green-50 p-4 text-center">
              <div className="text-2xl">&#127881;</div>
              <div className="mt-1 text-lg font-semibold text-green-700">全部打卡完成！</div>
              <div className="mt-1 text-sm text-green-600">
                已完成 {sorted.length}/{sorted.length} 个点位
              </div>
              <button
                type="button"
                className="mt-3 rounded-full bg-green-500 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600"
                onClick={() => void handleStatusChange('completed')}
              >
                完成巡礼
              </button>
            </div>
          )
        }

        if (!nextPoint) return null

        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nextPoint.pointId)}`
        const preview = getPointPreview(nextPoint.pointId)

        return (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/90 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-blue-700">
                导航模式 · {checkedCount}/{sorted.length}
              </span>
              <span className="text-xs text-blue-500">
                下一站 #{sorted.indexOf(nextPoint) + 1}
              </span>
            </div>
            <div className="grid gap-3 rounded-xl border border-blue-100 bg-white p-3 sm:grid-cols-[150px_1fr]">
              <div className="overflow-hidden rounded-xl">
                <div className="aspect-[16/10]">
                  <PointThumb preview={preview} seed={nextPoint.pointId} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-900">{preview.title}</div>
                <div className="text-xs text-slate-500">{preview.subtitle}</div>
                <div className="truncate text-xs text-slate-500">{nextPoint.pointId}</div>
                <div className="flex gap-2 pt-1">
                  <a
                    href={navUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white no-underline hover:bg-blue-600"
                  >
                    开始导航
                  </a>
                  <button
                    type="button"
                    className="rounded-lg bg-green-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600"
                    onClick={() => setCheckInTarget(nextPoint.pointId)}
                  >
                    打卡
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {checkInTarget && (
        <CheckInModal
          pointId={checkInTarget}
          pointName={getPointPreview(checkInTarget).title}
          onSuccess={() => {
            setCheckedInPointIds((prev) => new Set([...prev, checkInTarget]))
            setCheckInTarget(null)
            const allChecked = sorted.every((p) =>
              p.pointId === checkInTarget || checkedInPointIds.has(p.pointId)
            )
            if (allChecked) {
              void handleStatusChange('completed')
            }
          }}
          onClose={() => setCheckInTarget(null)}
        />
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">路线 ({sorted.length}/{SORTED_LIMIT})</h2>
          <span className="text-xs text-slate-500">拖拽卡片可重新排序</span>
        </div>

        {sorted.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <SortableContext items={sorted.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {sorted.map((point) => (
                  <SortablePointCard
                    key={point.id}
                    point={point}
                    preview={getPointPreview(point.pointId)}
                    onRemove={handleRemovePoint}
                    onMoveToUnsorted={() => void handleMoveToZone(point.pointId, 'unsorted')}
                    canMoveToSorted={canAddToSorted}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            从下方当前地图待排点中将点位加入路线，或去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>添加点位。
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">当前地图待排 ({unsorted.length})</h2>
          <span className="text-xs text-slate-500">这些点位已加入地图但还未进入路线</span>
        </div>

        {unsorted.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {unsorted.map((point) => (
              <PointCard
                key={point.id}
                point={point}
                preview={getPointPreview(point.pointId)}
                onRemove={handleRemovePoint}
                onMoveToSorted={() => void handleMoveToZone(point.pointId, 'sorted')}
                canMoveToSorted={canAddToSorted}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            当前地图待排为空。去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>添加点位到地图。
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">全局想去池 ({pointPoolItems.length})</h2>
          <span className="text-xs text-slate-500">这些点位点过「想去」但尚未加入任何地图</span>
        </div>

        {pointPoolItems.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {pointPoolItems.map((item) => {
              const preview = getPointPreview(item.pointId)
              return (
                <article
                  key={item.id}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_30px_-25px_rgba(15,23,42,0.45)]"
                >
                  <div className="relative aspect-[16/9] overflow-hidden border-b border-slate-100">
                    <PointThumb preview={preview} seed={item.pointId} />
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,6,23,0.72)_9%,rgba(2,6,23,0.08)_55%,rgba(255,255,255,0)_100%)]" />
                    <div className="absolute left-3 top-3 inline-flex rounded-full border border-white/55 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700 backdrop-blur-sm">
                      全局想去
                    </div>
                    <div className="absolute bottom-3 left-3 right-3 line-clamp-2 text-base font-semibold text-white drop-shadow-sm">
                      {preview.title}
                    </div>
                  </div>

                  <div className="space-y-3 p-3.5">
                    <p className="line-clamp-1 text-sm text-slate-500">{preview.subtitle}</p>
                    <p className="truncate rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-500">{item.pointId}</p>
                    <button
                      type="button"
                      className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-medium text-brand-700 transition hover:bg-brand-100"
                      onClick={() => {
                        void handleAddFromPointPool(item.pointId)
                      }}
                    >
                      加入当前地图
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            全局想去池为空。去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>点击“想去”来收集点位。
          </div>
        )}
      </section>

      {!canAddToSorted && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
          已排序路线已达上限 ({SORTED_LIMIT} 个点位)。如需添加新点位，请先移出部分已有点位。
        </div>
      )}
    </div>
  )
}
