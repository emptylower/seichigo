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

type RouteBookMetadata = {
  cover?: string
  description?: string
  city?: string
}

const STATUS_LABEL: Record<RouteBookStatus, string> = {
  draft: '草稿',
  in_progress: '进行中',
  completed: '已完成',
}

const STATUS_STYLE: Record<RouteBookStatus, string> = {
  draft: 'bg-white/80 text-slate-700',
  in_progress: 'bg-sky-500/85 text-white',
  completed: 'bg-emerald-500/85 text-white',
}

const STATUS_DESC: Record<RouteBookStatus, string> = {
  draft: '先收集点位，逐步补全路线。',
  in_progress: '正在巡礼中，可持续打卡推进进度。',
  completed: '这张地图已完成，可随时回看复盘。',
}

const ROUTEBOOK_FALLBACK_GRADIENTS = [
  'from-sky-500/80 via-cyan-400/70 to-brand-300/80',
  'from-brand-500/80 via-rose-400/75 to-orange-300/70',
  'from-violet-500/75 via-fuchsia-400/70 to-brand-400/70',
  'from-emerald-500/75 via-teal-400/70 to-cyan-300/70',
] as const

function pickRouteBookGradient(seed: string): string {
  let value = 0
  for (const char of seed) value = (value * 31 + char.charCodeAt(0)) % 997
  return ROUTEBOOK_FALLBACK_GRADIENTS[value % ROUTEBOOK_FALLBACK_GRADIENTS.length]
}

function parseMetadata(input: unknown): RouteBookMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const row = input as Record<string, unknown>
  return {
    cover: typeof row.cover === 'string' ? row.cover : undefined,
    description: typeof row.description === 'string' ? row.description : undefined,
    city: typeof row.city === 'string' ? row.city : undefined,
  }
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '最近更新'
  return parsed.toLocaleDateString('zh-CN')
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
      <div className="space-y-4">
        <div className="h-5 w-40 animate-pulse rounded bg-pink-100" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="overflow-hidden rounded-3xl border border-pink-100/90 bg-white/90 shadow-sm">
              <div className="aspect-[16/10] animate-pulse bg-slate-200" />
              <div className="space-y-3 p-4">
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
              </div>
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
          className="ml-auto inline-flex min-h-10 items-center rounded-full bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-brand-600"
          onClick={() => setShowCreate(true)}
        >
          新建地图
        </button>
      </div>

      {showCreate && (
        <div className="relative overflow-hidden rounded-3xl border border-pink-100/90 bg-[linear-gradient(140deg,rgba(255,255,255,0.94),rgba(253,242,248,0.84))] p-4 shadow-[0_18px_38px_-28px_rgba(236,72,153,0.55)] sm:p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-200/50 blur-3xl" />
          <div className="pointer-events-none absolute -left-12 bottom-0 h-24 w-24 rounded-full bg-cyan-200/50 blur-2xl" />

          <div className="relative space-y-1">
            <h2 className="text-base font-semibold text-slate-900">创建新地图</h2>
            <p className="text-sm text-slate-500">用于整理想去点位、排序路线与导出导航。</p>
          </div>
          <label className="relative mt-4 block text-sm font-medium text-slate-700">
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
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
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
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((item, index) => {
            const metadata = parseMetadata(item.metadata)
            const cover = metadata.cover || '/images/home/chopper-map-base.webp'
            const fallbackGradient = pickRouteBookGradient(`${item.id}:${item.title}`)
            const description = metadata.description || STATUS_DESC[item.status]
            const chips = [metadata.city, `创建于 ${formatDate(item.createdAt)}`].filter(Boolean)
            const prioritizeCover = index < 2

            return (
              <li
                key={item.id}
                className="group overflow-hidden rounded-[26px] border border-pink-100/90 bg-white shadow-[0_20px_38px_-30px_rgba(15,23,42,0.45)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_26px_45px_-28px_rgba(219,39,119,0.35)]"
              >
                <div className="relative isolate aspect-[16/10] overflow-hidden">
                  {metadata.cover ? (
                    <img
                      src={cover}
                      alt={item.title}
                      loading={prioritizeCover ? 'eager' : 'lazy'}
                      fetchPriority={index === 0 ? 'high' : 'auto'}
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <>
                      <div className={`absolute inset-0 bg-gradient-to-br ${fallbackGradient}`} />
                      <img
                        src={cover}
                        alt=""
                        aria-hidden="true"
                        loading={prioritizeCover ? 'eager' : 'lazy'}
                        fetchPriority={index === 0 ? 'high' : 'auto'}
                        decoding="async"
                        className="h-full w-full object-cover opacity-45 mix-blend-multiply"
                      />
                    </>
                  )}

                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,6,23,0.78)_10%,rgba(2,6,23,0.08)_55%,rgba(255,255,255,0)_100%)]" />
                  <div className={`absolute left-3 top-3 inline-flex rounded-full border border-white/50 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm ${STATUS_STYLE[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </div>
                  <div className="absolute right-3 top-3 inline-flex rounded-full border border-white/50 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                    更新于 {formatDate(item.updatedAt)}
                  </div>
                  <div className="absolute bottom-3 left-3 right-3">
                    <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-white drop-shadow-sm">
                      {item.title}
                    </h3>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <p className="line-clamp-2 text-sm leading-6 text-slate-600">{description}</p>

                  <div className="flex min-h-[28px] flex-wrap items-center gap-1.5">
                    {chips.map((chip) => (
                      <span key={`${item.id}-${chip}`} className="inline-flex rounded-full border border-pink-100 bg-pink-50/60 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                        {chip}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={`/me/routebooks/${item.id}`}
                      className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 no-underline transition hover:border-pink-200 hover:text-pink-700"
                    >
                      进入
                    </a>
                    <button
                      type="button"
                      className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-rose-200 hover:text-rose-600"
                      onClick={() => void handleDelete(item.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
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
