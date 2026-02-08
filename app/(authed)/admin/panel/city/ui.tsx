'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'

type CityItem = {
  id: string
  slug: string
  name_zh: string
  name_en?: string | null
  name_ja?: string | null
  cover?: string | null
  needsReview?: boolean
  hidden?: boolean
  aliasCount?: number
  postCount?: number
}

type ListResponse =
  | { ok: true; items: CityItem[]; total: number; page: number; pageSize: number }
  | { error: string }

export default function AdminCityListClient() {
  const [items, setItems] = useState<CityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(24)
  const [total, setTotal] = useState(0)

  const load = useCallback(async (query = q, nextPage = page) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(nextPage),
        pageSize: String(pageSize),
      })
      const res = await fetch(`/api/admin/city?${params.toString()}`, { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as ListResponse
      if (!res.ok || 'error' in data) {
        throw new Error('error' in data ? data.error : '加载失败')
      }

      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, q])

  useEffect(() => {
    void load('', 1)
  }, [load])

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    void load(q, 1)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">城市管理</h1>
        <p className="mt-1 text-sm text-gray-600">
          <Link href="/admin/dashboard" className="hover:underline">返回仪表盘</Link>
          {' · '}
          管理城市元数据、别名与合并。
        </p>
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <input
          className="w-full max-w-xs rounded-md border px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 slug / 名称 / 别名"
        />
        <Button type="submit" disabled={loading}>搜索</Button>
        <Button type="button" variant="ghost" disabled={loading} onClick={() => void load(q, page)}>
          刷新
        </Button>
      </form>

      <div className="text-xs text-gray-500">
        共 {total} 条，当前第 {page} / {totalPages} 页
      </div>

      {loading ? <AdminSkeleton rows={8} /> : null}
      {!loading && error ? <AdminErrorState message={error} onRetry={() => void load(q, page)} /> : null}

      {!loading && !error ? (
        items.length ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <li key={c.id} className={`rounded-xl border px-4 py-3 shadow-sm ${c.hidden ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/panel/city/${encodeURIComponent(c.id)}`} className="font-semibold hover:underline">
                    {c.name_zh}
                  </Link>
                  <div className="flex items-center gap-1">
                    {c.needsReview ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">待完善</span>
                    ) : null}
                    {c.hidden ? (
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600">已隐藏</span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1 text-xs font-mono text-gray-500">{c.slug}</div>
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>{c.postCount || 0} 篇文章</span>
                  <span>{c.aliasCount || 0} 别名</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState title="暂无匹配城市" description="尝试调整关键词或清空筛选条件。" />
        )
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          type="button"
          disabled={loading || page <= 1}
          onClick={() => void load(q, page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={loading || page >= totalPages}
          onClick={() => void load(q, page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
