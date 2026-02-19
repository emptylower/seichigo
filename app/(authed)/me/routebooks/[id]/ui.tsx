'use client'

import { useEffect, useState, useCallback } from 'react'
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

const STATUS_LABEL: Record<RouteBookStatus, string> = {
  draft: '草稿',
  in_progress: '进行中',
  completed: '已完成',
}

const STATUS_STYLE: Record<RouteBookStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
}

const SORTED_LIMIT = 25

function SortablePoint({ point, onRemove, onMoveToSorted, onMoveToUnsorted, canMoveToSorted }: {
  point: PointRecord
  onRemove: (pointId: string) => void
  onMoveToSorted?: () => void
  onMoveToUnsorted?: () => void
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
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
    >
      <button
        type="button"
        className="cursor-grab touch-none text-slate-400 hover:text-slate-600"
        {...attributes}
        {...listeners}
        aria-label="拖拽排序"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11" cy="13" r="1.5" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-800">
          {point.pointId}
        </div>
        <div className="text-xs text-slate-500">
          {point.zone === 'sorted' ? `#${point.sortOrder + 1}` : '未排序'}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onMoveToSorted && (
          <button
            type="button"
            disabled={!canMoveToSorted}
            className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onMoveToSorted}
            title={canMoveToSorted ? '移入路线' : `已排序区最多 ${SORTED_LIMIT} 个`}
          >
            加入路线
          </button>
        )}
        {onMoveToUnsorted && (
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-orange-600 hover:bg-orange-50"
            onClick={onMoveToUnsorted}
          >
            移出路线
          </button>
        )}
        <button
          type="button"
          className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          onClick={() => onRemove(point.pointId)}
        >
          移除
        </button>
      </div>
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
        setError('路书数据异常，请刷新重试')
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
      <a href="/me/routebooks" className="text-sm text-brand-600 hover:underline">返回路书列表</a>
    </div>
  )
  if (!routeBook) return null

  const canAddToSorted = sorted.length < SORTED_LIMIT

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                maxLength={100}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xl font-bold focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
              className="cursor-pointer text-2xl font-bold hover:text-brand-600"
              onClick={() => setEditingTitle(true)}
              title="点击编辑标题"
            >
              {routeBook.title}
            </h1>
          )}
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[routeBook.status]}`}>
              {STATUS_LABEL[routeBook.status]}
            </span>
            <span>{new Date(routeBook.createdAt).toISOString().slice(0, 10)}</span>
          </div>
        </div>
        <a
          href="/me/routebooks"
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          返回列表
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        {routeBook.status === 'draft' && (
          <button
            type="button"
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
            onClick={() => void handleStatusChange('in_progress')}
          >
            开始巡礼
          </button>
        )}
        {routeBook.status === 'in_progress' && (
          <>
            <button
              type="button"
              className="rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600"
              onClick={() => void handleStatusChange('completed')}
            >
              完成巡礼
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => void handleStatusChange('draft')}
            >
              回到草稿
            </button>
          </>
        )}
        {routeBook.status === 'completed' && (
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
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
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            在 Google Maps 中查看路线
          </a>
        )}
      </div>

      {routeBook.status === 'in_progress' && sorted.length > 0 && (() => {
        const nextPoint = sorted.find((p) => !checkedInPointIds.has(p.pointId))
        const checkedCount = sorted.filter((p) => checkedInPointIds.has(p.pointId)).length
        const allDone = checkedCount === sorted.length

        if (allDone) {
          return (
            <div className="rounded-xl border-2 border-green-200 bg-green-50 p-4 text-center">
              <div className="text-2xl">&#127881;</div>
              <div className="mt-1 text-lg font-semibold text-green-700">全部打卡完成！</div>
              <div className="mt-1 text-sm text-green-600">
                已完成 {sorted.length}/{sorted.length} 个点位
              </div>
              <button
                type="button"
                className="mt-3 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600"
                onClick={() => void handleStatusChange('completed')}
              >
                完成巡礼
              </button>
            </div>
          )
        }

        if (!nextPoint) return null

        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nextPoint.pointId)}`

        return (
          <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-blue-700">
                导航模式 · {checkedCount}/{sorted.length}
              </span>
              <span className="text-xs text-blue-500">
                下一站 #{sorted.indexOf(nextPoint) + 1}
              </span>
            </div>
            <div className="rounded-lg bg-white p-3">
              <div className="text-sm font-medium text-slate-900">{nextPoint.pointId}</div>
              <div className="mt-2 flex gap-2">
                <a
                  href={navUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600"
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
            <div className="mt-3 space-y-1">
              {sorted.map((p, i) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                    p.pointId === nextPoint.pointId
                      ? 'bg-blue-100 font-medium text-blue-800'
                      : checkedInPointIds.has(p.pointId)
                        ? 'text-green-600 line-through'
                        : 'text-slate-500'
                  }`}
                >
                  <span className="w-5 text-center">
                    {checkedInPointIds.has(p.pointId) ? '&#10003;' : `${i + 1}`}
                  </span>
                  <span className="truncate">{p.pointId}</span>
                  {!checkedInPointIds.has(p.pointId) && p.pointId !== nextPoint.pointId && (
                    <button
                      type="button"
                      className="ml-auto text-green-600 hover:text-green-700"
                      onClick={() => setCheckInTarget(p.pointId)}
                    >
                      打卡
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {checkInTarget && (
        <CheckInModal
          pointId={checkInTarget}
          pointName={checkInTarget}
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

      <div>
        <h2 className="mb-3 text-lg font-semibold">
          路线 ({sorted.length}/{SORTED_LIMIT})
        </h2>
        {sorted.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <SortableContext items={sorted.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {sorted.map((point) => (
                  <SortablePoint
                    key={point.id}
                    point={point}
                    onRemove={handleRemovePoint}
                    onMoveToUnsorted={() => void handleMoveToZone(point.pointId, 'unsorted')}
                    canMoveToSorted={canAddToSorted}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            从下方收集篮中将点位加入路线，或去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>添加点位。
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">
          收集篮 ({unsorted.length})
        </h2>
        {unsorted.length > 0 ? (
          <div className="space-y-2">
            {unsorted.map((point) => (
              <SortablePoint
                key={point.id}
                point={point}
                onRemove={handleRemovePoint}
                onMoveToSorted={() => void handleMoveToZone(point.pointId, 'sorted')}
                canMoveToSorted={canAddToSorted}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            收集篮为空。去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>添加点位到路书。
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">
          点位池 ({pointPoolItems.length})
        </h2>
        {pointPoolItems.length > 0 ? (
          <div className="space-y-2">
            {pointPoolItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{item.pointId}</div>
                  <div className="text-xs text-slate-500">想去点位</div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                  onClick={() => {
                    void handleAddFromPointPool(item.pointId)
                  }}
                >
                  加入收集篮
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            点位池为空。去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>点击“想去”来收集点位。
          </div>
        )}
      </div>

      {!canAddToSorted && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
          已排序路线已达上限 ({SORTED_LIMIT} 个点位)。如需添加新点位，请先移出部分已有点位。
        </div>
      )}
    </div>
  )
}
