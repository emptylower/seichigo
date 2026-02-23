'use client'

import { useEffect, useState, useCallback } from 'react'
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

  if (loading) return <div className="text-gray-600">加载中…</div>
  if (error) return <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的地图</h1>
        <button
          type="button"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          onClick={() => setShowCreate(true)}
        >
          新建地图
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block text-sm font-medium text-slate-700">
            地图标题
            <input
              type="text"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="例：东京圣地巡礼地图"
              maxLength={100}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
              }}
              autoFocus
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={creating || !createTitle.trim()}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
              onClick={() => void handleCreate()}
            >
              {creating ? '创建中…' : '创建'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
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
            <li key={item.id} className="card flex items-center justify-between gap-4">
              <div className="min-w-0">
                <a href={`/me/routebooks/${item.id}`} className="block truncate font-medium hover:text-brand-600">
                  {item.title}
                </a>
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                  <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                  <span>{new Date(item.createdAt).toISOString().slice(0, 10)}</span>
                </div>
              </div>
              <button
                type="button"
                className="rounded-md border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => void handleDelete(item.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
          <p className="text-gray-600">还没有地图。</p>
          <p className="mt-1 text-sm text-gray-500">
            去<a href="/anitabi" className="text-brand-600 hover:underline">圣地地图</a>标记想去的地点，然后创建地图规划你的巡礼路线。
          </p>
        </div>
      )}
    </div>
  )
}
