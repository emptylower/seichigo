'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RouteBookStatus } from '@/lib/routeBook/repo'

type RouteBookItem = {
  id: string
  title: string
  status: RouteBookStatus
  metadata: unknown | null
  createdAt: string
  updatedAt: string
}

type ListResponse =
  | { ok: true; items: RouteBookItem[] }
  | { error: string }

type CreateResponse =
  | { ok: true; routeBook?: RouteBookItem; item?: RouteBookItem }
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

export default function RouteBooksClient() {
  const [items, setItems] = useState<RouteBookItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/me/routebooks')
      const data = (await res.json().catch(() => ({}))) as ListResponse
      if (!res.ok || 'error' in data) {
        setError(('error' in data && data.error) || '加载失败')
        return
      }
      setItems(data.items || [])
    } catch {
      setError('加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate() {
    const title = createTitle.trim()
    if (!title) return
    setCreating(true)
    const res = await fetch('/api/me/routebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    const data = (await res.json().catch(() => ({}))) as CreateResponse
    setCreating(false)
    if (!res.ok || 'error' in data) {
      setError(('error' in data && data.error) || '创建失败')
      return
    }
    setCreateTitle('')
    setShowCreate(false)
    void load()
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/me/routebooks/${id}`, { method: 'DELETE' })
    if (!res.ok) return
    setItems((prev) => prev.filter((x) => x.id !== id))
  }

  const statusCount = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc[item.status] += 1
        return acc
      },
      { draft: 0, in_progress: 0, completed: 0 } as Record<RouteBookStatus, number>
    )
  }, [items])

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded bg-pink-100" />
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="rounded-2xl border border-pink-100/90 bg-white/90 p-4 shadow-sm">
              <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
              <div className="mt-3 h-3 w-20 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
        <p>{error}</p>
        <button
          type="button"
          className="mt-3 inline-flex rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-100"
          onClick={() => void load()}
        >
          重新加载
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2.5 text-xs font-medium">
        <span className="inline-flex rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-pink-700">
          共 {items.length} 张地图
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
          草稿 {statusCount.draft}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
          进行中 {statusCount.in_progress}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
          已完成 {statusCount.completed}
        </span>
        <button
          type="button"
          className="ml-auto inline-flex min-h-10 items-center rounded-full bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
          onClick={() => setShowCreate(true)}
        >
          新建地图
        </button>
      </div>

      {showCreate && (
        <div className="rounded-2xl border border-pink-100 bg-gradient-to-br from-white to-pink-50/50 p-4 shadow-sm sm:p-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">创建新地图</h2>
            <p className="text-sm text-slate-500">用于整理想去点位、排序路线与导出导航。</p>
          </div>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            地图标题
          </label>
          <input
            type="text"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder="例：东京圣地巡礼地图"
            maxLength={100}
            className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
            }}
            autoFocus
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={creating || !createTitle.trim()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
              onClick={() => void handleCreate()}
            >
              {creating ? '创建中…' : '创建'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => { setShowCreate(false); setCreateTitle('') }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {items.length ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-2xl border border-pink-100/90 bg-gradient-to-br from-white via-white to-pink-50/50 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                    <span>更新于 {new Date(item.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  <a href={`/me/routebooks/${item.id}`} className="block truncate text-[15px] font-semibold text-slate-800 no-underline hover:text-brand-700">
                    {item.title}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/me/routebooks/${item.id}`}
                    className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 no-underline hover:border-pink-200 hover:text-pink-700"
                  >
                    进入
                  </a>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => void handleDelete(item.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-pink-200 bg-white/80 p-8 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-pink-50 text-pink-500">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3c-4.97 0-9 3.58-9 8 0 3.1 1.98 5.79 4.88 7.13.3.14.52.42.57.74l.43 2.78a1 1 0 0 0 1.62.66l2.44-1.94a1 1 0 0 1 .73-.22c4.5.2 8.33-3.16 8.33-7.15 0-4.42-4.03-8-9-8z" />
            </svg>
          </div>
          <p className="text-gray-700">还没有地图。</p>
          <p className="mt-1 text-sm text-gray-500">
            去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>标记想去的地点，然后创建地图规划你的巡礼路线。
          </p>
        </div>
      )}
    </div>
  )
}
